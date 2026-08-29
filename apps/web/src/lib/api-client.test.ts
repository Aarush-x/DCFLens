import { describe, expect, it, vi } from "vitest";

import {
  analyzeTicker,
  ApiClientError,
  parseAnalysisEnvelope,
  type FetchImplementation,
} from "@/lib/api-client";
import { backendPayloadFromFixture } from "@/test/live-analysis-fixture";

const productionEnvironment = {
  NODE_ENV: "production",
  NEXT_PUBLIC_API_URL: "https://dcflens-api.example.com/",
};

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("analyzeTicker", () => {
  it("retries a bounded Render cold start before running analysis", async () => {
    const fetchImpl = vi
      .fn<FetchImplementation>()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockRejectedValueOnce(new TypeError("still waking"))
      .mockResolvedValueOnce(jsonResponse({ status: "ok" }))
      .mockResolvedValueOnce(jsonResponse(backendPayloadFromFixture()));
    const phases: Array<[string, number]> = [];

    const result = await analyzeTicker("aapl", {
      environment: productionEnvironment,
      fetchImpl,
      sleep: async () => {},
      onPhase: (phase, attempt) => phases.push([phase, attempt]),
    });

    expect(result.companyName).toBe("Apple Inc.");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(phases).toEqual([
      ["backend_waking", 1],
      ["backend_waking", 2],
      ["backend_waking", 3],
      ["analysis_running", 1],
    ]);
  });

  it.each([
    [404, "unsupported_ticker", "unsupported_ticker"],
    [422, "missing_sec_data", "sec_data_unavailable"],
    [422, "calculation_error", "analysis_unavailable"],
    [429, "provider_rate_limit", "rate_limit"],
    [503, "sec_provider_unavailable", "sec_data_unavailable"],
    [500, "internal_error", "unexpected"],
  ] as const)("maps HTTP %s and %s distinctly", async (status, code, expectedKind) => {
    const fetchImpl = vi
      .fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse({ status: "ok" }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code, message: "safe message", request_id: "request-123" } },
          status,
          status === 429 ? { "Retry-After": "60" } : undefined,
        ),
      );

    await expect(
      analyzeTicker("AAPL", { environment: productionEnvironment, fetchImpl }),
    ).rejects.toMatchObject({ kind: expectedKind, options: { requestId: "request-123" } });
  });

  it("cancels an in-flight wake-up request", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<FetchImplementation>(
      async (_url, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const request = analyzeTicker("AAPL", {
      environment: productionEnvironment,
      fetchImpl,
      signal: controller.signal,
    });

    controller.abort();

    await expect(request).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("sends only public, non-secret request metadata", async () => {
    const fetchImpl = vi
      .fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse({ status: "ok" }))
      .mockResolvedValueOnce(jsonResponse(backendPayloadFromFixture()));

    await analyzeTicker("AAPL", { environment: productionEnvironment, fetchImpl });

    const serializedCalls = JSON.stringify(fetchImpl.mock.calls);
    expect(serializedCalls).not.toMatch(/GOOGLE_API_KEY|SEC_IDENTITY|GEMINI|Bearer/i);
    expect(serializedCalls).toContain("Accept");
  });
});

describe("parseAnalysisEnvelope", () => {
  it("converts the FastAPI snake_case contract to frontend casing", () => {
    const result = parseAnalysisEnvelope(backendPayloadFromFixture());

    expect(result.analysis.finalValuation.intrinsicValuePerShare).toBe(96.86);
    expect(result.analysis.deterministicChecklist[0].checklistNumber).toBe(1);
    expect(result.latestFiling?.accessionNumber).toBe("0000320193-25-000003");
  });

  it("rejects incomplete success payloads instead of fabricating a result", () => {
    expect(() => parseAnalysisEnvelope({ ticker: "AAPL", analysis: {} })).toThrow(
      ApiClientError,
    );
  });
});
