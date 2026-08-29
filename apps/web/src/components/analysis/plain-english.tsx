import type { AnalysisEnvelope, NarrativeClaim } from "@/lib/analysis-types";
import type { AnalysisView } from "@/lib/analysis-view";
import { EvidenceCitation } from "@/components/analysis/evidence-citation";
import { EvidenceTrace } from "@/components/motion/evidence-trace";
import { Reveal } from "@/components/motion/reveal";
import { StatusLabel } from "@/components/status-label";

/**
 * The plain-English layer. Nothing here may use a financial term without
 * explaining it in the same breath — "discount rate", "terminal value",
 * "free cash flow", and "WACC" belong under "Know why".
 */

/**
 * Every disagreement is printed as its own statement. None of them are
 * averaged together, and none of them are replaced by a score.
 */
export function DisagreementCallout({ view }: { view: AnalysisView }) {
  const { disagreement } = view;

  return (
    <section
      className={`callout callout--${disagreement.hasDisagreement ? "conflict" : "agree"}`}
      aria-labelledby="disagreement-title"
    >
      <h2 id="disagreement-title">
        {disagreement.hasDisagreement ? "Where this analysis disagrees with itself" : "Nothing here conflicts"}
      </h2>
      <p className="callout__headline">{disagreement.headline}</p>
      {disagreement.statements.length > 1 ? (
        <ul className="callout__list">
          {disagreement.statements.slice(1).map((statement) => (
            <li key={statement.kind}>{statement.text}</li>
          ))}
        </ul>
      ) : null}
      {disagreement.checklistDisagreements.length > 0 ? (
        <ul className="callout__conflicts">
          {disagreement.checklistDisagreements.map((item) => (
            <li key={item.checklistNumber}>
              <span className="callout__conflict-number financial-value">
                Check {String(item.checklistNumber).padStart(2, "0")}
              </span>
              <span className="callout__conflict-text">{item.checklistText}</span>
              <span className="callout__conflict-verdicts">
                <span>
                  From the reported numbers: <StatusLabel status={item.deterministicStatus} />
                </span>
                <span>
                  From the written review: <StatusLabel status={item.aiStatus} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Evidence quality, confidence, and the checklist tally, side by side. */
export function PlainAssessment({
  envelope,
  view,
}: {
  envelope: AnalysisEnvelope;
  view: AnalysisView;
}) {
  const { confidence } = envelope.analysis;
  const counts = view.checklistSummary.counts;

  return (
    <section className="assessment" aria-labelledby="assessment-title">
      <h2 id="assessment-title">How much weight this deserves</h2>
      <Reveal selector=".assessment__grid > article">
        <div className="assessment__grid">
          <article>
            <h3>How good is the evidence?</h3>
            <p className="assessment__value">{view.evidence.label}</p>
            <p>{view.evidence.statement}</p>
            <p className="assessment__note">
              {view.evidence.citedEvidenceCount} filing reference
              {view.evidence.citedEvidenceCount === 1 ? "" : "s"} sit behind those claims. Every one
              of them is linked further down.
            </p>
          </article>

          <article>
            <h3>How confident are we?</h3>
            <p className="assessment__value">{confidence.level}</p>
            <p>{view.aiCoverage.statement}</p>
            <p className="assessment__note">
              This is not the chance of the price reaching the estimate. It is a summary of how
              complete the data was, how steady the numbers are, and how much the two readings agree.
            </p>
          </article>

          <article>
            <h3>The ten-point checklist</h3>
            <p className="assessment__value financial-value">
              {counts.SUPPORTS}/{view.checklistSummary.total}
            </p>
            <p>{view.checklistSummary.statement}</p>
            <p className="assessment__note">
              The full list, in its original wording and order, is under{" "}
              <a href="#know-why-checklist">the checklist section</a>.
            </p>
          </article>
        </div>
      </Reveal>

      {view.fragility.isFragile ? (
        <div className="fragility">
          <h3>Why we are cautious about this estimate</h3>
          <ul>
            {view.fragility.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** The four narrative lists, each claim carrying its own filing citation. */
export function PlainNarrativeSection({
  envelope,
  view,
}: {
  envelope: AnalysisEnvelope;
  view: AnalysisView;
}) {
  const { narrative } = envelope;

  const blocks: { id: string; title: string; hint: string; claims: NarrativeClaim[] }[] = [
    {
      id: "must-be-true",
      title: "What must be true for this to hold",
      hint: "The estimate assumes all of these. If one fails, the number is wrong.",
      claims: narrative.whatMustBeTrue,
    },
    {
      id: "supports",
      title: "What supports the estimate",
      hint: "Things in the filings that make the estimate more believable.",
      claims: narrative.whatSupports,
    },
    {
      id: "weakens",
      title: "What weakens the estimate",
      hint: "Things in the filings that cut the other way.",
      claims: narrative.whatWeakens,
    },
    {
      id: "prove-wrong",
      title: "What could prove it wrong",
      hint: "Specific things to watch for. If you see one, come back and redo this.",
      claims: narrative.whatCouldProveItWrong,
    },
  ];

  return (
    <section className="narrative" aria-labelledby="narrative-title">
      <h2 id="narrative-title">The reasoning, in plain words</h2>
      <EvidenceTrace>
        <Reveal selector=".narrative__block">
          <div className="narrative__grid">
            {blocks.map((block) => (
              <article key={block.id} className={`narrative__block narrative__block--${block.id}`}>
                <h3>{block.title}</h3>
                <p className="narrative__hint">{block.hint}</p>
                {block.claims.length === 0 ? (
                  <p className="narrative__empty">Nothing was recorded here for this company.</p>
                ) : (
                  <ol className="narrative__claims">
                    {block.claims.map((claim) => (
                      <li key={claim.statement}>
                        <p>{claim.statement}</p>
                        <EvidenceCitation
                          evidenceIds={claim.evidenceIds}
                          evidenceById={view.evidenceById}
                          unsupportedLabel="No filing backs this directly — it is a judgement, not a reported fact."
                        />
                      </li>
                    ))}
                  </ol>
                )}
              </article>
            ))}
          </div>
        </Reveal>
      </EvidenceTrace>
    </section>
  );
}
