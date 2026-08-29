import type { ReactNode } from "react";

/**
 * A native details/summary block. Keyboard operation, the expanded state, and
 * screen-reader announcement all come from the element itself, so there is no
 * JavaScript and no ARIA to keep in sync.
 */
export function Disclosure({
  id,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="disclosure" id={id} open={defaultOpen}>
      <summary className="disclosure__summary">
        <h3 className="disclosure__title">{title}</h3>
        {summary === undefined ? null : <span className="disclosure__hint">{summary}</span>}
      </summary>
      <div className="disclosure__body">{children}</div>
    </details>
  );
}
