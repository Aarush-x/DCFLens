"use client";

import { useRef, type ReactNode } from "react";

import { MOTION, planDisclosure } from "@/lib/motion";
import { prefersReducedMotion, useReducedMotion } from "@/lib/reduced-motion";

import { gsap, useGSAP } from "./gsap";

/**
 * Gives the "Know why" disclosures an opening motion, without taking over how
 * they work.
 *
 * The disclosures themselves stay native `details`/`summary` elements with no
 * JavaScript of their own. This listens for `toggle` on the way down — `toggle`
 * does not bubble, but it still passes through the capture phase — so the
 * enhancement is purely additive: if this component never loads, or its handler
 * fails, every panel still opens, closes, and announces itself exactly as
 * before.
 *
 * Only opening is animated. Closing is instant, because animating a collapse
 * means intercepting the summary's click and re-implementing the element's own
 * behaviour, which is a large amount of risk to buy a fifth of a second of
 * easing.
 *
 * The panel's height is never animated. Growing a panel from zero shrinks the
 * document for the length of the tween, and when the reader is far enough down
 * the page the browser clamps their scroll position to the shorter document and
 * does not restore it afterwards — a measured 72px jump on the sensitivity
 * block. So the panel takes its full size in the same frame the element opens,
 * exactly as it would with no JavaScript at all, and only its contents settle.
 */
export function DisclosureMotion({ children }: { children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useGSAP(
    (_context, contextSafe) => {
      const root = scope.current;
      if (root === null || contextSafe === undefined || reducedMotion) {
        return;
      }

      const onToggle = contextSafe((event: Event) => {
        const details = event.target;
        if (!(details instanceof HTMLDetailsElement) || !details.open) {
          return;
        }

        const summary = details.querySelector("summary");
        const panel = details.querySelector<HTMLElement>(".disclosure__body");
        if (summary === null || panel === null) {
          return;
        }

        // Read the preference again here rather than trusting the value this
        // effect closed over: the reader may have changed it since.
        const summaryTop = summary.getBoundingClientRect().top;
        const plan = planDisclosure({
          reducedMotion: prefersReducedMotion(),
          summaryTop,
          viewportHeight: window.innerHeight,
          panelHeight: panel.scrollHeight,
        });

        if (plan.kind === "instant") {
          return;
        }

        const tween = gsap.from(panel, {
          opacity: 0,
          y: MOTION.shift,
          duration: plan.duration,
          ease: MOTION.ease,
          // The panel must end with no inline geometry at all, or a later
          // reflow — a font swap, a rotation — would be measured against
          // values that were only ever true for one frame.
          clearProps: "opacity,transform",
        });

        // Anything focused inside a panel that is still opening gets the panel
        // at full size immediately.
        const settle = () => {
          tween.progress(1, false);
        };
        panel.addEventListener("focusin", settle, { once: true });
        tween.eventCallback("onComplete", () => {
          panel.removeEventListener("focusin", settle);
        });
      });

      root.addEventListener("toggle", onToggle, true);
      return () => {
        root.removeEventListener("toggle", onToggle, true);
      };
    },
    { scope, dependencies: [reducedMotion], revertOnUpdate: true },
  );

  return (
    <div className="motion-scope" ref={scope}>
      {children}
    </div>
  );
}
