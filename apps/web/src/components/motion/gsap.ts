"use client";

import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { MOTION } from "@/lib/motion";

/**
 * The single registration point for GSAP and its plugins.
 *
 * Registering at module scope in a client module runs once per bundle and is
 * idempotent, so no component has to remember to do it. Every motion component
 * imports `gsap`, `ScrollTrigger`, and `useGSAP` from here rather than from the
 * packages, which is what keeps that guarantee true.
 */
gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * Mobile browsers resize the viewport as their toolbars collapse. Without this
 * every such resize would recalculate trigger positions and re-fire reveals
 * mid-scroll.
 */
ScrollTrigger.config({ ignoreMobileResize: true });

export { gsap, ScrollTrigger, useGSAP };

/**
 * The shared trigger for a one-shot reveal.
 *
 * `once` is what keeps the page quiet: the trigger fires a single time, then
 * kills itself, so nothing is left listening to scroll and nothing animates
 * off screen. Reveals never `scrub`, so scrolling is never driven by us.
 */
export function revealTrigger(trigger: Element): ScrollTrigger.Vars {
  return {
    trigger,
    start: MOTION.scrollStart,
    once: true,
  };
}

/**
 * Puts a timeline straight to its end state.
 *
 * Used when a reader reaches content before its reveal has run — by tabbing
 * into it, or by the browser restoring a scroll position — so that motion never
 * stands between them and what they came for.
 */
export function settleImmediately(timeline: gsap.core.Timeline | null): void {
  if (timeline !== null && timeline.progress() < 1) {
    timeline.progress(1, false);
  }
}
