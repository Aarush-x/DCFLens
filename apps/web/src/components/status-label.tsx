import type { ChecklistStatus } from "@/fixtures/analysis";

export function StatusLabel({ status }: { status: ChecklistStatus }) {
  return (
    <span className={`status-label status-label--${status.toLowerCase()}`}>
      {status.replace("_", " ")}
    </span>
  );
}
