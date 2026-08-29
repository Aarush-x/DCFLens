"use client";

import { useRef, type ReactNode } from "react";

import { MOTION, planReveal } from "@/lib/motion";
import { useReducedMotion } from "@/lib/reduced-motion";

import { gsap, revealTrigger, settleImmediately, useGSAP } from "./gsap";

export type RevealProps = {
  children: ReactNode;
  /**
   * What to reveal, as a selector resolved inside this wrapper. Defaults to the
   * wrapper's own children, which is the right unit for a group of cards; pass
   * a narrower selector to stagger rows inside a single element.
   */
  selector?: string;
  /** Skip the scroll trigger and play on mount. Reserved for above-the-fold content. */
  immediate?: boolean;
  shift?: number;
  duration?: number;
  /** Delay before an `immediate` sequence starts. Ignored for scroll reveals. */
  delay?: number;
  className?: string;
};

/**
 * Reveals a group of elements once, as they arrive.
 *
 * The wrapper is `display: contents`, so it contributes no box of its own and
 * cannot shift the layout it is dropped into — the surrounding grid and flow
 * behave exactly as they did before it was added. Only `opacity` and
 * `transform` are animated, both of which are composited and neither of which
 * reflows the page.
 *
 * Under `prefers-reduced-motion` no tween is created at all: the elements are
 * never given a starting state, so there is nothing to revert and no path by
 * which content can be left hidden.
 */
export function Reveal({
  children,
  selector = ":scope > *",
  immediate = false,
  shift,
  duration,
  delay = 0,
  className,
}: RevealProps) {
  const scope = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useGSAP(
    () => {
      const root = scope.current;
      if (root === null) {
        return;
      }

      const matched = gsap.utils.toArray<HTMLElement>(root.querySelectorAll(selector));
      const targets = matched.length > 0 ? matched : [];
      if (targets.length === 0) {
        return;
      }

      const plan = planReveal(targets.length, { reducedMotion, shift, duration });
      if (plan.kind === "static") {
        return;
      }

      const timeline = gsap.timeline({
        delay: immediate ? delay : 0,
        // The wrapper has no box of its own, so the first revealed element is
        // what the trigger measures against.
        scrollTrigger: immediate ? undefined : revealTrigger(targets[0]),
      });

      timeline.from(targets, {
        opacity: plan.from.opacity,
        y: plan.from.y,
        duration: plan.duration,
        stagger: plan.stagger,
        ease: MOTION.ease,
      });

      /**
       * A reader who tabs into the group before it has arrived gets it
       * immediately. Reveals must never be a queue you have to wait in.
       */
      const settle = () => settleImmediately(timeline);
      root.addEventListener("focusin", settle);

      return () => {
        root.removeEventListener("focusin", settle);
      };
    },
    {
      scope,
      dependencies: [reducedMotion, selector, immediate, shift, duration, delay],
      // Without this, a dependency change adds a second set of animations on
      // top of the first instead of replacing it — which is exactly what
      // happens when a reader turns on reduced motion mid-session.
      revertOnUpdate: true,
    },
  );

  return (
    <div className={className ?? "motion-scope"} ref={scope}>
      {children}
    </div>
  );
}
