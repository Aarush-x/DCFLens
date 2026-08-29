import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AnalysisExperience } from "@/components/analysis/analysis-experience";
import type { analyzeTicker } from "@/lib/api-client";
import { liveAnalysisFixture } from "@/test/live-analysis-fixture";

describe("AnalysisExperience", () => {
  it("renders a complete successful backend analysis", async () => {
    const loadAnalysis = vi.fn<typeof analyzeTicker>(async (_ticker, options) => {
      options?.onPhase?.("analysis_running", 1);
      return liveAnalysisFixture;
    });

    render(<AnalysisExperience ticker="AAPL" loadAnalysis={loadAnalysis} />);

    expect(screen.getByRole("heading", { name: "Preparing AAPL." })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "One evidence-backed estimate." })).toBeTruthy(),
    );
    expect(screen.getByText("$96.86")).toBeTruthy();
    expect(screen.getByText(/Gross Profit Margin > 20%/)).toBeTruthy();
    expect(screen.getByText("Analysis ready")).toBeTruthy();
  });

  it("keeps the last valid result visible while refreshing", async () => {
    let resolveRefresh: ((value: typeof liveAnalysisFixture) => void) | undefined;
    const loadAnalysis = vi
      .fn<typeof analyzeTicker>()
      .mockResolvedValueOnce(liveAnalysisFixture)
      .mockImplementationOnce(
        async () => await new Promise((resolve) => { resolveRefresh = resolve; }),
      );

    render(<AnalysisExperience ticker="AAPL" loadAnalysis={loadAnalysis} />);
    await screen.findByText("$96.86");
    screen.getByRole("button", { name: "Refresh analysis" }).click();

    expect(screen.getByText("$96.86")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Backend waking up")).toBeTruthy());
    resolveRefresh?.(liveAnalysisFixture);
    await waitFor(() => expect(screen.getByText("Analysis ready")).toBeTruthy());
  });
});
