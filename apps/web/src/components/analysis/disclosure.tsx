import type { ReactNode } from "react";

import type { AssemblyStep } from "@/lib/motion";

/**
 * A native details/summary block. Keyboard operation, the expanded state, and
 * screen-reader announcement all come from the element itself, so there is no
 * JavaScript and no ARIA to keep in sync. `DisclosureMotion` animates the
 * opening from the outside; nothing here depends on it having loaded.
 */
export function Disclosure({
  id,
  title,
  summary,
  defaultOpen = false,
  step,
  children,
}: {
  id: string;
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  /** Marks this block as a stage of the analysis pipeline, for `AssemblySequence`. */
  step?: AssemblyStep;
  children: ReactNode;
}) {
  return (
    <details className="disclosure" id={id} open={defaultOpen}>
      <summary className="disclosure__summary" data-assembly-step={step}>
        <h3 className="disclosure__title">{title}</h3>
        {summary === undefined ? null : <span className="disclosure__hint">{summary}</span>}
      </summary>
      <div className="disclosure__body">{children}</div>
    </details>
  );
}
