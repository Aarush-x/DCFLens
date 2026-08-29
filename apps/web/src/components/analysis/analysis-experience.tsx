"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { LiveAnalysisDocument } from "@/components/analysis/live-analysis-document";
import { Button } from "@/components/ui/button";
import {
  analyzeTicker,
  ApiClientError,
  type AnalysisRequestPhase,
} from "@/lib/api-client";
import type { LiveAnalysisEnvelope } from "@/lib/live-analysis-types";

type LoadAnalysis = typeof analyzeTicker;
type RequestState = {
  phase: "backend_waking" | "analysis_running" | "success" | "error";
  attempt: number;
  result: LiveAnalysisEnvelope | null;
  error: ApiClientError | null;
};

export function AnalysisExperience({
  ticker,
  loadAnalysis = analyzeTicker,
}: {
  ticker: string;
  loadAnalysis?: LoadAnalysis;
}) {
  const [state, setState] = useState<RequestState>({
    phase: "backend_waking",
    attempt: 1,
    result: null,
    error: null,
  });
  const activeRequest = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setState((current) => ({ ...current, phase: "backend_waking", attempt: 1, error: null }));

    const onPhase = (phase: AnalysisRequestPhase, attempt: number) => {
      setState((current) => ({ ...current, phase, attempt, error: null }));
    };

    try {
      const result = await loadAnalysis(ticker, { signal: controller.signal, onPhase });
      if (!controller.signal.aborted) {
        setState({ phase: "success", attempt: 1, result, error: null });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      const apiError =
        error instanceof ApiClientError
          ? error
          : new ApiClientError("unexpected", "An unexpected frontend error interrupted the analysis.", { cause: error });
      setState((current) => ({ ...current, phase: "error", error: apiError }));
    }
  }, [loadAnalysis, ticker]);

  useEffect(() => {
    const controller = new AbortController();
    const start = window.setTimeout(() => {
      if (!controller.signal.aborted) {
        void run();
      }
    }, 0);
    return () => {
      window.clearTimeout(start);
      controller.abort();
      activeRequest.current?.abort();
    };
  }, [run]);

  const status = requestStatus(state);

  return (
    <>
      <section className={`analysis-request-state analysis-request-state--${status.tone}`} aria-live="polite">
        <div>
          <p className="section-index">{status.eyebrow}</p>
          <h2>{status.title}</h2>
          <p>{status.detail}</p>
          {state.error?.options.requestId ? (
            <p className="request-id financial-value">Request ID: {state.error.options.requestId}</p>
          ) : null}
        </div>
        {state.phase === "error" || state.phase === "success" ? (
          <Button variant="secondary" onClick={() => void run()}>
            {state.result ? "Refresh analysis" : "Try again"}
          </Button>
        ) : (
          <div className="request-progress" aria-hidden="true"><span /></div>
        )}
      </section>
      {state.result ? (
        <LiveAnalysisDocument envelope={state.result} />
      ) : state.phase === "error" ? (
        <section className="analysis-empty" aria-labelledby="analysis-empty-title">
          <h1 id="analysis-empty-title">No analysis was returned.</h1>
          <p>DCFLens will not display fixture data or invent a successful result after a failed request.</p>
        </section>
      ) : (
        <section className="analysis-empty" aria-labelledby="analysis-loading-title">
          <h1 id="analysis-loading-title">Preparing {ticker}.</h1>
          <p>The evidence-backed result will appear here when the backend finishes.</p>
        </section>
      )}
    </>
  );
}

function requestStatus(state: RequestState): {
  eyebrow: string;
  title: string;
  detail: string;
  tone: "working" | "success" | "warning" | "error";
} {
  if (state.phase === "backend_waking") {
    return {
      eyebrow: `Connection attempt ${state.attempt}`,
      title: "Backend waking up",
      detail: "Render may need a short moment to wake the API. DCFLens is retrying within a fixed limit.",
      tone: "working",
    };
  }
  if (state.phase === "analysis_running") {
    return {
      eyebrow: "SEC filing and valuation",
      title: "Analysis running",
      detail: "The API is awake and is retrieving evidence, calculating the DCF, and applying bounded AI review.",
      tone: "working",
    };
  }
  if (state.phase === "success") {
    return {
      eyebrow: "Completed analysis",
      title: state.result?.analysis.status === "DETERMINISTIC_FALLBACK" ? "Valuation ready · AI unavailable" : "Analysis ready",
      detail: state.result?.analysis.status === "DETERMINISTIC_FALLBACK"
        ? "The deterministic result remains valid; the qualitative AI layer was not applied."
        : "The filing evidence and completed valuation are shown below.",
      tone: state.result?.analysis.status === "DETERMINISTIC_FALLBACK" ? "warning" : "success",
    };
  }

  const error = state.error;
  const labels: Record<NonNullable<typeof error>["kind"], [string, string]> = {
    configuration: ["Frontend configuration error", "NEXT_PUBLIC_API_URL is required in production. Configure it in Vercel and rebuild."],
    cancelled: ["Request cancelled", "The request was cancelled before an analysis completed."],
    timeout: ["Analysis timed out", "The backend was awake, but the bounded analysis window expired."],
    unsupported_ticker: ["Unsupported ticker", "The ticker is invalid or is not present in the SEC company mapping."],
    sec_data_unavailable: ["SEC data unavailable", "Required filing facts could not be retrieved or normalized."],
    analysis_unavailable: ["Valuation unavailable", "The returned SEC facts could not produce a valid deterministic valuation."],
    rate_limit: ["Provider rate limit", "SEC EDGAR asked the service to slow down. Wait before retrying."],
    backend_unavailable: ["Backend unavailable", "The API did not become ready within the bounded cold-start window."],
    unexpected: ["Unexpected failure", "The service returned an unrecognized response. No result has been fabricated."],
  };
  const [title, detail] = labels[error?.kind ?? "unexpected"];
  return { eyebrow: "Analysis interrupted", title, detail, tone: "error" };
}
