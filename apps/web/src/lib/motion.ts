/**
 * Motion tokens and the pure planning functions behind every animation on the
 * site. Nothing here imports GSAP or touches the DOM, so the rules that decide
 * *whether* and *how far* something moves can be tested directly.
 *
 * The house style is restraint. Motion exists to show that one thing follows
 * from another — a fact leading to a valuation, a citation leading to a
 * conclusion. It never carries information of its own, so a reader who never
 * sees it loses nothing.
 */

/** Every duration in seconds, every distance in pixels. */
export const MOTION = {
  /**
   * The durations the design system already defines: 120ms micro, 180ms short,
   * 240ms medium. Nothing on the page animates for longer than `slow`.
   */
  duration: { fast: 0.12, base: 0.18, slow: 0.24 },
  ease: "power2.out",
  /** Reveals travel a short distance: enough to read as arrival, not as travel. */
  shift: 10,
  /** Per-item delay in a staggered group. */
  stagger: 0.04,
  /** A staggered group finishes within this budget no matter how long it is. */
  staggerBudget: 0.24,
  /**
   * Reveals fire when the element is already well inside the viewport, so the
   * reader is never waiting on an animation to see what they scrolled to.
   */
  scrollStart: "top 88%",
} as const;

/** The order the analysis assembles in: each step is only true once the one before it is. */
export const ASSEMBLY_STEPS = [
  "ticker",
  "facts",
  "checklist",
  "adjustment",
  "valuation",
] as const;

export type AssemblyStep = (typeof ASSEMBLY_STEPS)[number];

/**
 * A group of `count` items staggers by `MOTION.stagger` each, until the group
 * is long enough that doing so would exceed the budget — then the per-item
 * delay shrinks to fit. A ten-point checklist must not take a second to appear
 * just because it has ten points.
 */
export function resolveStagger(
  count: number,
  perItem: number = MOTION.stagger,
  budget: number = MOTION.staggerBudget,
): number {
  if (count <= 1) {
    return 0;
  }
  const gaps = count - 1;
  return Math.min(perItem, budget / gaps);
}

/** The longest a staggered group can take from first item to last item settled. */
export function staggerDuration(count: number, duration: number = MOTION.duration.base): number {
  if (count <= 0) {
    return 0;
  }
  return resolveStagger(count) * Math.max(count - 1, 0) + duration;
}

export type RevealVars = { opacity: number; y: number };

export type RevealPlan =
  | { kind: "static" }
  | { kind: "animate"; from: RevealVars; to: RevealVars; duration: number; stagger: number };

/**
 * The one decision every reveal makes. Under reduced motion the plan is
 * `static`: not a shorter animation, not a fade — no animation at all, and no
 * starting state to clean up.
 */
export function planReveal(
  count: number,
  options: { reducedMotion: boolean; shift?: number; duration?: number },
): RevealPlan {
  if (options.reducedMotion) {
    return { kind: "static" };
  }
  return {
    kind: "animate",
    from: { opacity: 0, y: options.shift ?? MOTION.shift },
    to: { opacity: 1, y: 0 },
    duration: options.duration ?? MOTION.duration.base,
    stagger: resolveStagger(count),
  };
}

/**
 * Financial figures are never counted up.
 *
 * Tweening $184.80 from zero renders a stream of numbers the filings do not
 * support — $61.20, $137.44 — and a reader who glances mid-tween reads a
 * precise valuation that was invented by an easing curve. The figure is
 * therefore always in the DOM at its true value; only its opacity and position
 * settle. `swap` covers a figure whose value genuinely changed, which
 * cross-fades between two real values with no interpolation between them.
 */
export type FigurePlan =
  | { kind: "static" }
  | { kind: "settle"; duration: number; from: RevealVars }
  | { kind: "swap"; duration: number };

export function planFigure(options: {
  reducedMotion: boolean;
  previousText?: string | null;
  nextText: string;
}): FigurePlan {
  if (options.reducedMotion) {
    return { kind: "static" };
  }
  const previous = options.previousText ?? null;
  if (previous !== null && previous !== options.nextText) {
    return { kind: "swap", duration: MOTION.duration.fast };
  }
  return {
    kind: "settle",
    duration: MOTION.duration.base,
    from: { opacity: 0, y: MOTION.shift / 2 },
  };
}

/**
 * Whether an opening disclosure is worth animating at all.
 *
 * The panel's height is never animated — see `DisclosureMotion` for why — so
 * this is only about whether anyone is in a position to see the settle. A
 * summary off screen means the reader is looking elsewhere, and a panel taller
 * than two screenfuls cannot be taken in as one movement.
 */
export function planDisclosure(options: {
  reducedMotion: boolean;
  summaryTop: number;
  viewportHeight: number;
  panelHeight: number;
}): { kind: "instant" } | { kind: "expand"; duration: number } {
  const { reducedMotion, summaryTop, viewportHeight, panelHeight } = options;
  if (reducedMotion) {
    return { kind: "instant" };
  }
  const summaryOffscreen = summaryTop < 0 || summaryTop > viewportHeight;
  if (summaryOffscreen) {
    return { kind: "instant" };
  }
  if (panelHeight > viewportHeight * 2) {
    return { kind: "instant" };
  }
  return { kind: "expand", duration: MOTION.duration.base };
}
