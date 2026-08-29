import type { EvidenceReference } from "@/lib/analysis-types";

/**
 * Renders the evidence behind a claim as links to the filing itself. A claim
 * with no evidence says so in words rather than rendering nothing, because an
 * absent citation is the thing a reader most needs to notice.
 */
export function EvidenceCitation({
  evidenceIds,
  evidenceById,
  unsupportedLabel = "No filing cited for this statement.",
}: {
  evidenceIds: string[];
  evidenceById: Map<string, EvidenceReference>;
  unsupportedLabel?: string;
}) {
  const references = evidenceIds
    .map((id) => evidenceById.get(id))
    .filter((reference): reference is EvidenceReference => reference !== undefined);

  if (references.length === 0) {
    return <p className="citation citation--empty">{unsupportedLabel}</p>;
  }

  return (
    <ul className="citation">
      {references.map((reference) => (
        <li key={reference.evidenceId}>
          <a href={reference.sourceUrl} rel="noreferrer" target="_blank">
            {reference.filingForm} · {reference.xbrlConcept} · {reference.fiscalPeriod}
            <span className="citation__external" aria-hidden="true"> ↗</span>
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
          <span className="citation__id financial-value">{reference.evidenceId}</span>
        </li>
      ))}
    </ul>
  );
}
