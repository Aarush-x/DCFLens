"use client";

import { useRef, type ReactNode } from "react";

import { MOTION } from "@/lib/motion";
import { useReducedMotion } from "@/lib/reduced-motion";

import { gsap, revealTrigger, useGSAP } from "./gsap";

/**
 * Draws the line between a filing and the sentence that rests on it.
 *
 * Each claim in the plain-English layer carries its own citation into the
 * annual report. The connector is a one-pixel rule that grows from the
 * statement down to that citation as the claim arrives, so the reader sees the
 * conclusion attached to its source rather than merely printed above it.
 *
 * The rule is decorative and marked `aria-hidden`: the relationship it draws is
 * already stated in the markup, where the citation sits inside the claim's own
 * list item. Nothing is communicated by the line alone.
 */
export function EvidenceTrace({ children }: { children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useGSAP(
    () => {
      const root = scope.current;
      if (root === null || reducedMotion) {
        return;
      }

      const traces = gsap.utils.toArray<HTMLElement>(root.querySelectorAll(".citation__trace"));

      traces.forEach((trace) => {
        const claim = trace.closest("li") ?? trace;
        gsap.from(trace, {
          scaleY: 0,
          duration: MOTION.duration.slow,
          ease: MOTION.ease,
          // `transform-origin` is set in CSS so the resting state is correct
          // even before any of this runs.
          scrollTrigger: revealTrigger(claim),
        });
      });
    },
    { scope, dependencies: [reducedMotion], revertOnUpdate: true },
  );

  return (
    <div className="motion-scope" ref={scope}>
      {children}
    </div>
  );
}
