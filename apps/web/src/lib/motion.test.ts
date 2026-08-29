import { describe, expect, it } from "vitest";

import {
  ASSEMBLY_STEPS,
  MOTION,
  planDisclosure,
  planFigure,
  planReveal,
  resolveStagger,
  staggerDuration,
} from "./motion";

describe("resolveStagger", () => {
  it("does not stagger a group of one", () => {
    expect(resolveStagger(1)).toBe(0);
    expect(resolveStagger(0)).toBe(0);
  });

  it("uses the full per-item delay for short groups", () => {
    expect(resolveStagger(3)).toBe(MOTION.stagger);
  });

  it("compresses long groups so the ten-point checklist is not a queue", () => {
    const ten = resolveStagger(10);
    expect(ten).toBeLessThan(MOTION.stagger);
    expect(staggerDuration(10)).toBeLessThanOrEqual(MOTION.staggerBudget + MOTION.duration.base);
  });

  it("keeps every group inside the same budget no matter how long", () => {
    for (const count of [2, 5, 10, 25, 100]) {
      expect(staggerDuration(count)).toBeLessThanOrEqual(
        MOTION.staggerBudget + MOTION.duration.base + 1e-9,
      );
    }
  });
});

describe("MOTION tokens", () => {
  it("stays inside the 120/180/240ms scale the design system defines", () => {
    expect(MOTION.duration.fast).toBeCloseTo(0.12);
    expect(MOTION.duration.base).toBeCloseTo(0.18);
    expect(MOTION.duration.slow).toBeCloseTo(0.24);
  });

  it("reveals from close by, so motion reads as arrival and not as travel", () => {
    expect(MOTION.shift).toBeLessThanOrEqual(12);
  });
});

describe("planReveal", () => {
  it("builds no animation at all under reduced motion", () => {
    expect(planReveal(4, { reducedMotion: true })).toEqual({ kind: "static" });
  });

  it("never hides content behind visibility, only opacity and offset", () => {
    const plan = planReveal(4, { reducedMotion: false });
    expect(plan.kind).toBe("animate");
    if (plan.kind !== "animate") {
      return;
    }
    expect(Object.keys(plan.from).sort()).toEqual(["opacity", "y"]);
    expect(plan.to).toEqual({ opacity: 1, y: 0 });
  });
});

describe("planFigure", () => {
  it("does nothing under reduced motion", () => {
    expect(planFigure({ reducedMotion: true, nextText: "$184.80" })).toEqual({ kind: "static" });
  });

  it("settles a first-render figure without touching its value", () => {
    const plan = planFigure({ reducedMotion: false, nextText: "$184.80" });
    expect(plan.kind).toBe("settle");
  });

  it("swaps a changed figure whole, with no interpolated step between", () => {
    const plan = planFigure({
      reducedMotion: false,
      previousText: "$165.00",
      nextText: "$205.00",
    });
    expect(plan).toEqual({ kind: "swap", duration: MOTION.duration.fast });
  });

  it("never returns a numeric value to render — only real values are ever shown", () => {
    const plans = [
      planFigure({ reducedMotion: false, nextText: "$184.80" }),
      planFigure({ reducedMotion: false, previousText: "$1.00", nextText: "$184.80" }),
      planFigure({ reducedMotion: true, previousText: "$1.00", nextText: "$184.80" }),
    ];
    for (const plan of plans) {
      expect(JSON.stringify(plan)).not.toMatch(/184|165|205/);
    }
  });

  it("treats an unchanged value as an arrival, not a change", () => {
    const plan = planFigure({
      reducedMotion: false,
      previousText: "$184.80",
      nextText: "$184.80",
    });
    expect(plan.kind).toBe("settle");
  });
});

describe("planDisclosure", () => {
  const base = { reducedMotion: false, summaryTop: 200, viewportHeight: 900, panelHeight: 400 };

  it("expands when the summary is on screen and the panel is a sane size", () => {
    expect(planDisclosure(base)).toEqual({ kind: "expand", duration: MOTION.duration.base });
  });

  it("opens instantly under reduced motion", () => {
    expect(planDisclosure({ ...base, reducedMotion: true })).toEqual({ kind: "instant" });
  });

  it("opens instantly when the summary is above the viewport, which is where a jump would happen", () => {
    expect(planDisclosure({ ...base, summaryTop: -40 })).toEqual({ kind: "instant" });
  });

  it("opens instantly when the summary is below the viewport", () => {
    expect(planDisclosure({ ...base, summaryTop: 1200 })).toEqual({ kind: "instant" });
  });

  it("opens a very tall panel instantly rather than animating a screen and a half of height", () => {
    expect(planDisclosure({ ...base, panelHeight: 4000 })).toEqual({ kind: "instant" });
  });
});

describe("ASSEMBLY_STEPS", () => {
  it("is the pipeline order the page is assembled in", () => {
    expect([...ASSEMBLY_STEPS]).toEqual([
      "ticker",
      "facts",
      "checklist",
      "adjustment",
      "valuation",
    ]);
  });
});
