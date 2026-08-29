import type { ReactNode } from "react";

/**
 * A horizontally scrollable wrapper for wide data tables.
 *
 * The wrapper is focusable and labelled: a scrollable region that cannot be
 * reached by keyboard is unusable without a pointer (WCAG 2.1.1), and an
 * unlabelled one gives a screen reader nothing to announce on entry.
 */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-scroll" role="group" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
