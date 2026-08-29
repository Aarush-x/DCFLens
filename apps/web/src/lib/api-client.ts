import { getApiBaseUrl } from "@/lib/api-url";
import type { LiveAnalysisEnvelope } from "@/lib/live-analysis-types";

export type AnalysisRequestPhase = "backend_waking" | "analysis_running";

export type ApiErrorKind =
  | "configuration"
  | "cancelled"
  | "timeout"
  | "unsupported_ticker"
  | "sec_data_unavailable"
  | "analysis_unavailable"
  | "rate_limit"
  | "backend_unavailable"
  | "unexpected";

export class ApiClientError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    message: string,
    public readonly options: {
      code?: string;
      requestId?: string;
      retryAfterSeconds?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiClientError";
  }
}

export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type SleepImplementation = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export interface AnalyzeTickerOptions {
  signal?: AbortSignal;
  onPhase?: (phase: AnalysisRequestPhase, attempt: number) => void;
  fetchImpl?: FetchImplementation;
  sleep?: SleepImplementation;
  healthAttempts?: number;
  healthTimeoutMs?: number;
  analysisTimeoutMs?: number;
}

const DEFAULT_HEALTH_ATTEMPTS = 5;
const DEFAULT_HEALTH_TIMEOUT_MS = 8_000;
const DEFAULT_ANALYSIS_TIMEOUT_MS = 90_000;
const COLD_START_DELAYS_MS = [1_000, 2_000, 4_000, 6_000] as const;

export async function analyzeTicker(
  rawTicker: string,
  options: AnalyzeTickerOptions = {},
): Promise<LiveAnalysisEnvelope> {
  const ticker = normalizeTicker(rawTicker);
  let apiBaseUrl: string;
  try {
    apiBaseUrl = getApiBaseUrl();
  } catch (error) {
    throw new ApiClientError(
      "configuration",
      error instanceof Error ? error.message : "The public API URL is not configured.",
      { cause: error },
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? sleepWithSignal;
  await waitForBackend(apiBaseUrl, {
    signal: options.signal,
    onPhase: options.onPhase,
    fetchImpl,
    sleep,
    attempts: options.healthAttempts ?? DEFAULT_HEALTH_ATTEMPTS,
    timeoutMs: options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
  });

  options.onPhase?.("analysis_running", 1);
  const response = await fetchWithTimeout(
    `${apiBaseUrl}/api/analyze/${encodeURIComponent(ticker)}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: options.signal,
    },
    options.analysisTimeoutMs ?? DEFAULT_ANALYSIS_TIMEOUT_MS,
    fetchImpl,
  );

  if (!response.ok) {
    throw await mapHttpError(response);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ApiClientError("unexpected", "The analysis service returned unreadable data.", {
      cause: error,
    });
  }
  return parseAnalysisEnvelope(payload);
}

function normalizeTicker(rawTicker: string): string {
  const ticker = rawTicker.trim().toUpperCase().replaceAll(".", "-");
  if (!/^[A-Z][A-Z0-9-]{0,9}$/.test(ticker)) {
    throw new ApiClientError(
      "unsupported_ticker",
      "Enter a valid ticker using up to 10 letters, numbers, or hyphens.",
      { code: "invalid_ticker" },
    );
  }
  return ticker;
}

async function waitForBackend(
  apiBaseUrl: string,
  options: {
    signal?: AbortSignal;
    onPhase?: AnalyzeTickerOptions["onPhase"];
    fetchImpl: FetchImplementation;
    sleep: SleepImplementation;
    attempts: number;
    timeoutMs: number;
  },
): Promise<void> {
  const attempts = Math.max(1, Math.min(options.attempts, 8));
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    options.onPhase?.("backend_waking", attempt);
    try {
      const response = await fetchWithTimeout(
        `${apiBaseUrl}/health`,
        { method: "GET", headers: { Accept: "application/json" }, signal: options.signal },
        options.timeoutMs,
        options.fetchImpl,
      );
      if (response.ok) {
        return;
      }
      lastError = new Error(`Health endpoint returned ${response.status}`);
    } catch (error) {
      if (error instanceof ApiClientError && error.kind === "cancelled") {
        throw error;
      }
      lastError = error;
    }

    if (attempt < attempts) {
      const delay = COLD_START_DELAYS_MS[Math.min(attempt - 1, COLD_START_DELAYS_MS.length - 1)];
      await options.sleep(delay, options.signal);
    }
  }

  throw new ApiClientError(
    "backend_unavailable",
    "The backend did not become ready within the bounded wake-up window.",
    { cause: lastError },
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { signal?: AbortSignal },
  timeoutMs: number,
  fetchImpl: FetchImplementation,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const externalSignal = init.signal;
  const cancelFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    cancelFromExternal();
  } else {
    externalSignal?.addEventListener("abort", cancelFromExternal, { once: true });
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));

  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, credentials: "omit" });
  } catch (error) {
    if (externalSignal?.aborted) {
      throw new ApiClientError("cancelled", "The analysis request was cancelled.", { cause: error });
    }
    if (timedOut) {
      throw new ApiClientError("timeout", "The analysis service took too long to respond.", {
        cause: error,
      });
    }
    throw new ApiClientError("backend_unavailable", "The analysis service could not be reached.", {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", cancelFromExternal);
  }
}

async function sleepWithSignal(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new ApiClientError("cancelled", "The analysis request was cancelled.");
  }
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    const cancel = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      reject(new ApiClientError("cancelled", "The analysis request was cancelled."));
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

async function mapHttpError(response: Response): Promise<ApiClientError> {
  let errorBody: { error?: { code?: string; message?: string; request_id?: string } } = {};
  try {
    errorBody = (await response.json()) as typeof errorBody;
  } catch {
    // A missing error envelope is mapped using the safe HTTP status below.
  }
  const code = errorBody.error?.code;
  const requestId = errorBody.error?.request_id;
  const retryAfter = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
  const common = {
    code,
    requestId,
    retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
  };

  if (code === "invalid_ticker" || code === "unsupported_ticker" || response.status === 404) {
    return new ApiClientError("unsupported_ticker", "That ticker is not supported by SEC EDGAR.", common);
  }
  if (code === "missing_sec_data" || code === "sec_provider_unavailable") {
    return new ApiClientError("sec_data_unavailable", "Required SEC filing data is unavailable.", common);
  }
  if (code === "calculation_error") {
    return new ApiClientError("analysis_unavailable", "The available facts could not produce a valid valuation.", common);
  }
  if (code === "provider_rate_limit" || response.status === 429) {
    return new ApiClientError("rate_limit", "The SEC provider rate limit was reached.", common);
  }
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return new ApiClientError("backend_unavailable", "The backend is temporarily unavailable.", common);
  }
  return new ApiClientError("unexpected", "The analysis service returned an unexpected error.", common);
}

export function parseAnalysisEnvelope(payload: unknown): LiveAnalysisEnvelope {
  const camel = camelize(payload);
  if (!isRecord(camel) || !isRecord(camel.analysis)) {
    throw new ApiClientError("unexpected", "The analysis response did not match the expected contract.");
  }
  const valuation = camel.analysis.finalValuation;
  const checklist = camel.analysis.deterministicChecklist;
  if (
    typeof camel.ticker !== "string" ||
    typeof camel.companyName !== "string" ||
    !isRecord(valuation) ||
    typeof valuation.intrinsicValuePerShare !== "number" ||
    !isRecord(valuation.inputs) ||
    typeof valuation.inputs.currency !== "string" ||
    !isRecord(valuation.assumptions) ||
    !isRecord(valuation.terminalValue) ||
    !isRecord(valuation.decomposition) ||
    !isRecord(valuation.sensitivityInterval) ||
    !isRecord(checklist) ||
    !Array.isArray(checklist.results) ||
    !Array.isArray(camel.analysis.evidenceAssessment) ||
    !isRecord(camel.analysis.confidence) ||
    !isRecord(camel.analysis.disagreement)
  ) {
    throw new ApiClientError("unexpected", "The analysis response did not match the expected contract.");
  }

  return {
    ...(camel as unknown as Omit<LiveAnalysisEnvelope, "analysis">),
    analysis: {
      ...(camel.analysis as unknown as LiveAnalysisEnvelope["analysis"]),
      deterministicChecklist:
        checklist.results as unknown as LiveAnalysisEnvelope["analysis"]["deterministicChecklist"],
    },
  };
}

function camelize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(camelize);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      camelize(child),
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
