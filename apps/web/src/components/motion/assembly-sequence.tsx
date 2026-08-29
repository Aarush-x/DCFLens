"use client";

import { useRef, type ReactNode } from "react";

import { ASSEMBLY_STEPS, MOTION, planReveal, type AssemblyStep } from "@/lib/motion";
import { useReducedMotion } from "@/lib/reduced-motion";

import { gsap, revealTrigger, useGSAP } from "./gsap";

export const ASSEMBLY_ATTRIBUTE = "data-assembly-step";

/**
 * Orders the elements marked with `data-assembly-step` into the pipeline's own
 * order, ignoring any that are absent from the page.
 *
 * Kept separate from the component so the ordering rule can be tested without
 * mounting anything.
 */
export function orderAssemblyStages<T>(
  stages: { step: string; element: T }[],
): { step: AssemblyStep; element: T }[] {
  const index = new Map<string, number>(ASSEMBLY_STEPS.map((step, position) => [step, position]));
  return stages
    .filter((stage): stage is { step: AssemblyStep; element: T } => index.has(stage.step))
    .sort((a, b) => (index.get(a.step) ?? 0) - (index.get(b.step) ?? 0));
}

/**
 * The reading order of the analysis, made visible: the ticker, then the facts
 * pulled from the filing, then the checklist applied to them, then the model's
 * adjustment, then the valuation those produce.
 *
 * Each stage reveals on its own one-shot trigger as the reader reaches it, so
 * scrolling is never intercepted and no stage waits on another. The pipeline
 * order decides only the emphasis each stage is given — the first stage in the
 * chain arrives from slightly further than the last, which reads as a sequence
 * rather than as five identical fades.
 */
export function AssemblySequence({ children }: { children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useGSAP(
    () => {
      const root = scope.current;
      if (root === null || reducedMotion) {
        return;
      }

      const marked = gsap.utils
        .toArray<HTMLElement>(root.querySelectorAll(`[${ASSEMBLY_ATTRIBUTE}]`))
        .map((element) => ({ step: element.getAttribute(ASSEMBLY_ATTRIBUTE) ?? "", element }));

      const stages = orderAssemblyStages(marked);

      stages.forEach(({ element }, position) => {
        const plan = planReveal(1, {
          reducedMotion,
          // Earlier links in the chain travel a little further than later ones.
          shift: MOTION.shift * (1 - position / (stages.length * 2)),
        });
        if (plan.kind === "static") {
          return;
        }
        gsap.from(element, {
          opacity: plan.from.opacity,
          y: plan.from.y,
          duration: plan.duration,
          ease: MOTION.ease,
          scrollTrigger: revealTrigger(element),
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
