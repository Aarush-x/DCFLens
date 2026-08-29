import type { ChecklistStatus } from "@/lib/analysis-types";
import { humanizeStatus } from "@/lib/format";

/**
 * Status is carried by the word, not the colour. The colour is a secondary
 * cue so the label still reads correctly in monochrome or with a colour
 * vision deficiency.
 */
export function StatusLabel({ status }: { status: ChecklistStatus }) {
  return (
    <span className={`status-label status-label--${status.toLowerCase()}`}>
      {humanizeStatus(status)}
    </span>
  );
}
