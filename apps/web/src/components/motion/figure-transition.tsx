"use client";

import { useRef, type ReactNode } from "react";

import { MOTION, planFigure } from "@/lib/motion";
import { prefersReducedMotion, useReducedMotion } from "@/lib/reduced-motion";

import { ScrollTrigger, gsap, revealTrigger, useGSAP } from "./gsap";

const FIGURE_SELECTOR = ".financial-value";

/**
 * Brings financial figures into place, and never counts them up.
 *
 * A figure tweened from zero prints values the filings do not support — a
 * reader glancing at $137.44 on the way to $184.80 has read a precise valuation
 * invented by an easing curve, on a page whose whole argument is that its
 * numbers are traceable. So the figure is in the DOM at its true value from the
 * first render and stays there: only its opacity and position settle.
 *
 * When a figure's value genuinely changes, the new value is faded in as a
 * whole. There is no intermediate state, because there is no intermediate fact.
 */
export function FigureTransition({
  children,
  /**
   * Set to false where an enclosing `Reveal` already brings the figures in, so
   * a figure is never faded twice for the same arrival.
   */
  settleOnReveal = true,
}: {
  children: ReactNode;
  settleOnReveal?: boolean;
}) {
  const scope = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useGSAP(
    () => {
      const root = scope.current;
      if (root === null || reducedMotion) {
        return;
      }

      const figures = gsap.utils.toArray<HTMLElement>(root.querySelectorAll(FIGURE_SELECTOR));
      if (figures.length === 0) {
        return;
      }

      if (settleOnReveal) {
        figures.forEach((figure) => {
          const plan = planFigure({ reducedMotion, nextText: figure.textContent ?? "" });
          if (plan.kind !== "settle") {
            return;
          }
          gsap.from(figure, {
            opacity: plan.from.opacity,
            y: plan.from.y,
            duration: plan.duration,
            ease: MOTION.ease,
            scrollTrigger: revealTrigger(figure),
          });
        });
      }

      /**
       * Figures only change when new data replaces old. Off-screen figures are
       * left alone entirely — there is no one to show the transition to, and
       * animating them would burn frames a phone needs elsewhere.
       */
      const observer = new MutationObserver((records) => {
        if (document.visibilityState === "hidden" || prefersReducedMotion()) {
          return;
        }
        const changed = new Set<HTMLElement>();
        for (const record of records) {
          const node = record.target;
          const element = node instanceof HTMLElement ? node : node.parentElement;
          const figure = element?.closest<HTMLElement>(FIGURE_SELECTOR) ?? null;
          if (figure !== null && root.contains(figure) && ScrollTrigger.isInViewport(figure)) {
            changed.add(figure);
          }
        }
        for (const figure of changed) {
          gsap.fromTo(
            figure,
            { opacity: 0 },
            { opacity: 1, duration: MOTION.duration.fast, ease: MOTION.ease, clearProps: "opacity" },
          );
        }
      });

      observer.observe(root, { characterData: true, childList: true, subtree: true });

      return () => {
        observer.disconnect();
      };
    },
    { scope, dependencies: [reducedMotion, settleOnReveal], revertOnUpdate: true },
  );

  return (
    <div className="motion-scope" ref={scope}>
      {children}
    </div>
  );
}
