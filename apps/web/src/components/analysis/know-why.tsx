import type { AnalysisEnvelope, DcfAssumptions } from "@/lib/analysis-types";
import type { AnalysisView } from "@/lib/analysis-view";
import { Disclosure } from "@/components/analysis/disclosure";
import { TableScroll } from "@/components/analysis/table-scroll";
import { EvidenceCitation } from "@/components/analysis/evidence-citation";
import { StatusLabel } from "@/components/status-label";
import {
  formatCompactUsd,
  formatDate,
  formatDateTime,
  formatRate,
  formatRateDelta,
  formatScore,
  formatShares,
  formatSignedUsd,
  formatUsd,
  humanizeKey,
} from "@/lib/format";

/**
 * The technical layer. Everything the plain-English layer stated is traceable
 * from here to the assumption, the calculation, and the filing it came from.
 *
 * Each block is a native disclosure so a reader can open only what they need,
 * and so the whole layer stays reachable by keyboard without any JavaScript.
 */
export function KnowWhy({
  envelope,
  view,
}: {
  envelope: AnalysisEnvelope;
  view: AnalysisView;
}) {
  const { analysis } = envelope;
  const baseline = analysis.deterministicBaseline;
  const valuation = analysis.finalValuation;
  const currency = valuation.currency;

  return (
    <section className="know-why" id="know-why" aria-labelledby="know-why-title">
      <div className="know-why__heading">
        <p className="section-index">Know why</p>
        <h2 id="know-why-title">Show me the workings.</h2>
        <p>
          Every figure above comes from something below. This is where the plain
          words are replaced by the assumptions, the arithmetic, and the filing
          references they rest on.
        </p>
      </div>

      <Disclosure
        id="know-why-baseline"
        title="Starting assumptions, before any model input"
        summary="Where each rate came from, and what moved it"
        defaultOpen
      >
        <p className="disclosure__lede">
          These are derived from the company&rsquo;s own reported history and a
          versioned set of sector starting points. No model wrote them.
        </p>
        <AssumptionsTable assumptions={baseline.assumptions} caption="Baseline assumptions" />
        <ol className="trace-list">
          {baseline.traces.map((item) => (
            <li key={item.assumption}>
              <h4>
                {item.label}{" "}
                <span className="financial-value trace-list__value">
                  {formatRate(item.finalBaseline)}
                </span>
              </h4>
              <p className="trace-list__plain">{item.plainEnglishExplanation}</p>
              <p className="trace-list__technical">{item.technicalExplanation}</p>
              <dl className="mini-ledger">
                {item.sectorPrior === null ? null : (
                  <div>
                    <dt>Sector starting point</dt>
                    <dd className="financial-value">
                      {formatRate(item.sectorPrior.value)} · {item.sectorPrior.parameter} ·{" "}
                      {item.sectorPrior.version}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Data coverage</dt>
                  <dd className="financial-value">{formatScore(item.dataCoverageConfidence)}</dd>
                </div>
                <div>
                  <dt>Stability</dt>
                  <dd className="financial-value">{formatScore(item.stabilityConfidence)}</dd>
                </div>
              </dl>
              {item.companyModifiers.length > 0 ? (
                <ul className="modifier-list">
                  {item.companyModifiers.map((modifier) => (
                    <li key={modifier.name}>
                      <span className="financial-value">{formatRateDelta(modifier.value)}</span>{" "}
                      <strong>{humanizeKey(modifier.name)}</strong> — {modifier.rationale}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="trace-list__empty">No company-specific adjustment was applied.</p>
              )}
              {item.boundsApplied.length > 0 ? (
                <ul className="modifier-list">
                  {item.boundsApplied.map((bound) => (
                    <li key={bound.name}>
                      <strong>{humanizeKey(bound.name)}</strong>{" "}
                      <span className="financial-value">
                        [{formatRate(bound.lower)}, {formatRate(bound.upper)}]
                      </span>{" "}
                      — {bound.wasApplied ? "held at the bound" : "inside the bound, not applied"}
                    </li>
                  ))}
                </ul>
              ) : null}
              {item.fallbacks.length > 0 ? (
                <p className="trace-list__fallback">
                  Fallbacks used: {item.fallbacks.map(humanizeKey).join("; ")}.
                </p>
              ) : null}
              <EvidenceCitation evidenceIds={item.evidenceIds} evidenceById={view.evidenceById} />
            </li>
          ))}
        </ol>
      </Disclosure>

      <Disclosure
        id="know-why-adjustments"
        title="Changes the written review asked for"
        summary={
          analysis.adjustments.length === 0
            ? "None were applied"
            : `${analysis.adjustments.length} applied, each bounded and shown separately`
        }
        defaultOpen
      >
        <p className="disclosure__lede">
          Model-proposed changes are never folded into the baseline. Each one is
          listed here with its bounds, its reason, its evidence, and the effect
          it had on its own.
        </p>
        {analysis.status === "DETERMINISTIC_FALLBACK" ? (
          <p className="notice notice--warning">
            The written review did not run. {analysis.fallbackReason} No assumption was changed.
          </p>
        ) : null}
        {analysis.adjustments.length === 0 ? (
          <p className="trace-list__empty">
            The written review proposed no changes to the assumptions. The final
            assumptions are identical to the baseline.
          </p>
        ) : (
          <ol className="adjustment-list">
            {analysis.adjustments.map((adjustment) => (
              <li key={adjustment.assumption}>
                <h4>{adjustment.label}</h4>
                <dl className="mini-ledger">
                  <div>
                    <dt>Baseline</dt>
                    <dd className="financial-value">{formatRate(adjustment.baselineAssumption)}</dd>
                  </div>
                  <div>
                    <dt>Model change</dt>
                    <dd className="financial-value">{formatRateDelta(adjustment.aiAdjustment)}</dd>
                  </div>
                  <div>
                    <dt>Final</dt>
                    <dd className="financial-value">{formatRate(adjustment.finalAssumption)}</dd>
                  </div>
                  <div>
                    <dt>Allowed range</dt>
                    <dd className="financial-value">
                      {formatRateDelta(adjustment.minimumAdjustment)} to{" "}
                      {formatRateDelta(adjustment.maximumAdjustment)}
                    </dd>
                  </div>
                  <div>
                    <dt>Effect on the estimate, on its own</dt>
                    <dd className="financial-value">
                      {formatSignedUsd(adjustment.isolatedValuationImpactPerShare, currency)} per
                      share
                    </dd>
                  </div>
                </dl>
                <p className="adjustment-list__rationale">{adjustment.rationale}</p>
                <EvidenceCitation
                  evidenceIds={adjustment.evidenceIds}
                  evidenceById={view.evidenceById}
                />
              </li>
            ))}
          </ol>
        )}
      </Disclosure>

      <Disclosure
        id="know-why-final"
        title="Final assumptions and what the changes did"
        summary="Baseline against final, per share"
      >
        <AssumptionsTable assumptions={analysis.finalAssumptions} caption="Final assumptions" />
        <dl className="mini-ledger mini-ledger--wide">
          <div>
            <dt>Estimate from the baseline assumptions</dt>
            <dd className="financial-value">
              {formatUsd(analysis.valuationImpact.baselineIntrinsicValuePerShare, currency)}
            </dd>
          </div>
          <div>
            <dt>Estimate after the model&rsquo;s changes</dt>
            <dd className="financial-value">
              {formatUsd(analysis.valuationImpact.finalIntrinsicValuePerShare, currency)}
            </dd>
          </div>
          <div>
            <dt>Change per share</dt>
            <dd className="financial-value">
              {formatSignedUsd(analysis.valuationImpact.absoluteChangePerShare, currency)}
            </dd>
          </div>
          <div>
            <dt>Change in relative terms</dt>
            <dd className="financial-value">
              {analysis.valuationImpact.relativeChange === null
                ? "Not calculable"
                : formatRate(analysis.valuationImpact.relativeChange)}
            </dd>
          </div>
        </dl>
      </Disclosure>

      <Disclosure
        id="know-why-facts"
        title="The reported figures this is built on"
        summary={`${envelope.facts.length} normalized facts from ${envelope.latestFiling.form} ${envelope.latestFiling.accessionNumber}`}
      >
        <TableScroll label="Normalized annual facts">
          <table className="data-table">
            <caption>Normalized annual facts, with the concept each was taken from</caption>
            <thead>
              <tr>
                <th scope="col">Figure</th>
                <th scope="col" className="numeric">Value</th>
                <th scope="col">Period</th>
                <th scope="col">XBRL concept</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {envelope.facts.map((fact) => (
                <tr key={fact.metric}>
                  <th scope="row">{fact.label}</th>
                  <td className="numeric financial-value">
                    {fact.unit === "shares"
                      ? formatShares(fact.value)
                      : formatCompactUsd(fact.value, fact.unit)}
                  </td>
                  <td className="financial-value">
                    FY{fact.fiscalYear} · ends {formatDate(fact.periodEnd)}
                  </td>
                  <td className="financial-value wrap-anywhere">{conceptFor(envelope, fact.evidenceIds[0])}</td>
                  <td>{fact.quality === "reported" ? "Reported directly" : "Calculated from reported figures"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Disclosure>

      <Disclosure
        id="know-why-dcf"
        title="The calculation itself"
        summary={`${valuation.projectedCashFlows.length} projected years, then a value for everything after`}
      >
        <p className="disclosure__lede">
          Each year&rsquo;s spare cash is grown at the assumed rate, then shrunk
          back to today&rsquo;s money using the required return. This is what a
          discounted cash flow is: the two operations, repeated.
        </p>
        <TableScroll label="Projected free cash flow by year">
          <table className="data-table">
            <caption>Projected free cash flow and its present value, by year</caption>
            <thead>
              <tr>
                <th scope="col">Year</th>
                <th scope="col">Stage</th>
                <th scope="col" className="numeric">Growth</th>
                <th scope="col" className="numeric">Free cash flow</th>
                <th scope="col" className="numeric">Discount factor</th>
                <th scope="col" className="numeric">Value today</th>
              </tr>
            </thead>
            <tbody>
              {valuation.projectedCashFlows.map((flow) => (
                <tr key={flow.year}>
                  <th scope="row" className="financial-value">{flow.year}</th>
                  <td className="financial-value">{flow.stage}</td>
                  <td className="numeric financial-value">{formatRate(flow.growthRate)}</td>
                  <td className="numeric financial-value">{formatCompactUsd(flow.freeCashFlow, currency)}</td>
                  <td className="numeric financial-value">{flow.discountFactor.toFixed(4)}</td>
                  <td className="numeric financial-value">{formatCompactUsd(flow.presentValue, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <dl className="mini-ledger mini-ledger--wide">
          {[
            ["Value today of years 1 to " + valuation.assumptions.stageOneYears, valuation.decomposition.presentValueStageOne],
            ["Value today of the remaining projected years", valuation.decomposition.presentValueStageTwo],
            ["Value today of everything after the projection", valuation.decomposition.presentValueTerminalValue],
            ["Value of the whole business today", valuation.decomposition.enterpriseValue],
            ["Less what the company owes, net of cash", valuation.decomposition.netDebtAdjustment],
            ["Value belonging to shareholders", valuation.decomposition.equityValue],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt>{label as string}</dt>
              <dd className="financial-value">{formatCompactUsd(value as number, currency)}</dd>
            </div>
          ))}
          <div>
            <dt>Shares it is divided across</dt>
            <dd className="financial-value">{formatShares(valuation.dilutedShares)}</dd>
          </div>
          <div>
            <dt>Value per share</dt>
            <dd className="financial-value">{formatUsd(valuation.intrinsicValuePerShare, currency)}</dd>
          </div>
        </dl>
        {valuation.warnings.length > 0 ? (
          <ul className="notice notice--warning notice--list">
            {valuation.warnings.map((warning) => (
              <li key={warning}>{humanizeKey(warning)}</li>
            ))}
          </ul>
        ) : null}
      </Disclosure>

      <Disclosure
        id="know-why-terminal"
        title="How much of this rests on the far future"
        summary={`${formatRate(valuation.terminalValue.concentration, 1)} of the business value`}
      >
        <p className="disclosure__lede">
          Everything past the last projected year is collapsed into a single
          figure. The larger its share, the more of the estimate depends on a
          period nobody can forecast.
        </p>
        <dl className="mini-ledger mini-ledger--wide">
          <div>
            <dt>Last projected year&rsquo;s spare cash</dt>
            <dd className="financial-value">{formatCompactUsd(valuation.terminalValue.finalProjectedFreeCashFlow, currency)}</dd>
          </div>
          <div>
            <dt>The year after that, grown once more</dt>
            <dd className="financial-value">{formatCompactUsd(valuation.terminalValue.terminalYearFreeCashFlow, currency)}</dd>
          </div>
          <div>
            <dt>Required return minus long-run growth</dt>
            <dd className="financial-value">{formatRate(valuation.terminalValue.capitalizationSpread)}</dd>
          </div>
          <div>
            <dt>Value of everything after, at that future date</dt>
            <dd className="financial-value">{formatCompactUsd(valuation.terminalValue.undiscountedTerminalValue, currency)}</dd>
          </div>
          <div>
            <dt>The same figure in today&rsquo;s money</dt>
            <dd className="financial-value">{formatCompactUsd(valuation.terminalValue.presentValue, currency)}</dd>
          </div>
          <div>
            <dt>Share of the whole business value</dt>
            <dd className="financial-value">{formatRate(valuation.terminalValue.concentration, 1)}</dd>
          </div>
        </dl>
      </Disclosure>

      <Disclosure
        id="know-why-sensitivity"
        title="How much the estimate moves when the assumptions move"
        summary="Two perturbed points, not a probability"
      >
        <p className="notice">
          This interval is produced by moving the growth and required-return
          assumptions by a fixed amount. It is not a confidence interval and it
          carries no probability. Method:{" "}
          <span className="financial-value">{valuation.sensitivityInterval.method}</span>. Growth
          moved by {formatRateDelta(valuation.sensitivityInterval.growthRateDelta)}, required return
          by {formatRateDelta(valuation.sensitivityInterval.discountRateDelta)}.
        </p>
        <TableScroll label="Sensitivity points and their assumptions">
          <table className="data-table">
            <caption>The two evaluated points and the assumptions behind each</caption>
            <thead>
              <tr>
                <th scope="col">Point</th>
                <th scope="col" className="numeric">Years 1&ndash;5 growth</th>
                <th scope="col" className="numeric">Years 6&ndash;10 growth</th>
                <th scope="col" className="numeric">Required return</th>
                <th scope="col" className="numeric">Value per share</th>
              </tr>
            </thead>
            <tbody>
              {valuation.sensitivityInterval.evaluatedPoints.map((point) => (
                <tr key={point.label}>
                  <th scope="row">{point.label}</th>
                  <td className="numeric financial-value">{formatRate(point.assumptions.stageOneGrowthRate)}</td>
                  <td className="numeric financial-value">{formatRate(point.assumptions.stageTwoGrowthRate)}</td>
                  <td className="numeric financial-value">{formatRate(point.assumptions.discountRate)}</td>
                  <td className="numeric financial-value">{formatUsd(point.intrinsicValuePerShare, currency)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Central: the assumptions actually used</th>
                <td className="numeric financial-value">{formatRate(valuation.assumptions.stageOneGrowthRate)}</td>
                <td className="numeric financial-value">{formatRate(valuation.assumptions.stageTwoGrowthRate)}</td>
                <td className="numeric financial-value">{formatRate(valuation.assumptions.discountRate)}</td>
                <td className="numeric financial-value">{formatUsd(valuation.sensitivityInterval.centralValuePerShare, currency)}</td>
              </tr>
            </tbody>
          </table>
        </TableScroll>
        {valuation.fcfStability === null ? (
          <p className="trace-list__empty">
            Too little history was available to judge how steady past spare cash has been.
          </p>
        ) : (
          <dl className="mini-ledger mini-ledger--wide">
            <div>
              <dt>Years of history used</dt>
              <dd className="financial-value">{valuation.fcfStability.observationCount}</dd>
            </div>
            <div>
              <dt>Lowest year</dt>
              <dd className="financial-value">{formatCompactUsd(valuation.fcfStability.minimumFreeCashFlow, currency)}</dd>
            </div>
            <div>
              <dt>Highest year</dt>
              <dd className="financial-value">{formatCompactUsd(valuation.fcfStability.maximumFreeCashFlow, currency)}</dd>
            </div>
            <div>
              <dt>Times it changed direction from positive to negative</dt>
              <dd className="financial-value">{valuation.fcfStability.signChangeCount}</dd>
            </div>
            <div>
              <dt>Judged unstable</dt>
              <dd>{valuation.fcfStability.isUnstable ? "Yes" : "No"}</dd>
            </div>
          </dl>
        )}
        <h4>What each confidence factor scored</h4>
        <TableScroll label="Confidence factors">
          <table className="data-table">
            <caption>Confidence factors. These are scores, not probabilities.</caption>
            <thead>
              <tr>
                <th scope="col">Factor</th>
                <th scope="col" className="numeric">Score</th>
                <th scope="col">What it measures</th>
              </tr>
            </thead>
            <tbody>
              {analysis.confidence.factors.map((item) => (
                <tr key={item.name}>
                  <th scope="row">{item.label}</th>
                  <td className="numeric financial-value">{formatScore(item.score)}</td>
                  <td>{item.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <p className="notice">{analysis.confidence.explanation}</p>
      </Disclosure>

      <Disclosure
        id="know-why-checklist"
        title="The original ten-point checklist, in full"
        summary="Unchanged wording, unchanged order"
        defaultOpen
      >
        <p className="disclosure__lede">
          The wording and order of these ten checks are fixed. Sector context
          changes only whether a check applies and what evidence answers it —
          never the check itself.
        </p>
        <ol className="full-checklist">
          {analysis.deterministicChecklist.map((result) => {
            const finding = analysis.checklistQualitativeFindings.find(
              (item) => item.checklistNumber === result.checklistNumber,
            );
            return (
              <li key={result.checklistNumber}>
                <div className="full-checklist__head">
                  <span className="full-checklist__number financial-value">
                    {String(result.checklistNumber).padStart(2, "0")}
                  </span>
                  <h4>{result.checklistText}</h4>
                  <StatusLabel status={result.status} />
                </div>
                <p className="full-checklist__plain">{result.plainEnglishExplanation}</p>
                <dl className="full-checklist__detail">
                  <div>
                    <dt>How this was decided</dt>
                    <dd>{result.technicalExplanation}</dd>
                  </div>
                  <div>
                    <dt>Why it does or does not apply</dt>
                    <dd>{result.applicabilityReason}</dd>
                  </div>
                  <div>
                    <dt>Sector context</dt>
                    <dd>{result.sectorContext}</dd>
                  </div>
                  <div>
                    <dt>How it could bear on the valuation</dt>
                    <dd>{result.potentialValuationRelevance}</dd>
                  </div>
                  <div>
                    <dt>From the written review</dt>
                    <dd>
                      {finding === undefined ? (
                        <span className="full-checklist__absent">
                          The written review did not reach this check. Nothing has been filled in
                          for it.
                        </span>
                      ) : (
                        <>
                          <StatusLabel status={finding.status} /> {finding.explanation}
                        </>
                      )}
                    </dd>
                  </div>
                </dl>
                {result.metricsUsed.length > 0 ? (
                  <ul className="metric-list">
                    {result.metricsUsed.map((metric) => (
                      <li key={metric.name}>
                        <strong>{humanizeKey(metric.name)}</strong>{" "}
                        <span className="financial-value">
                          {metric.unit.startsWith("decimal")
                            ? formatRate(metric.value)
                            : metric.unit === "USD"
                              ? formatCompactUsd(metric.value)
                              : metric.value}
                        </span>{" "}
                        — {metric.calculation} ({metric.fiscalPeriods.join(", ")})
                      </li>
                    ))}
                  </ul>
                ) : null}
                {result.missingInformation.length > 0 ? (
                  <p className="full-checklist__missing">
                    Missing before this could be answered fully:{" "}
                    {result.missingInformation.join("; ")}.
                  </p>
                ) : null}
                <EvidenceCitation
                  evidenceIds={result.evidenceIds}
                  evidenceById={view.evidenceById}
                  unsupportedLabel="No filing reference is attached to this check."
                />
              </li>
            );
          })}
        </ol>
      </Disclosure>

      <Disclosure
        id="know-why-sector"
        title="What kind of business this was treated as"
        summary={`${baseline.classification.sectorDisplayName} · ${humanizeKey(baseline.classification.businessType)}`}
      >
        <dl className="mini-ledger mini-ledger--wide">
          <div>
            <dt>Sector</dt>
            <dd>{baseline.classification.sectorDisplayName}</dd>
          </div>
          <div>
            <dt>Business type</dt>
            <dd>{humanizeKey(baseline.classification.businessType)}</dd>
          </div>
          <div>
            <dt>How it was classified</dt>
            <dd>{humanizeKey(baseline.classification.method)}</dd>
          </div>
          <div>
            <dt>What matched</dt>
            <dd>{baseline.classification.matchedObservation}</dd>
          </div>
          <div>
            <dt>Classification confidence</dt>
            <dd className="financial-value">{formatScore(baseline.classification.confidence)}</dd>
          </div>
          <div>
            <dt>Sector starting points used</dt>
            <dd className="financial-value">{baseline.priorVersion}</dd>
          </div>
        </dl>
        <p className="notice">
          Sector affects which checks apply and which starting points are used. It
          never changes the wording of a check or the reported figures.
        </p>
      </Disclosure>

      <Disclosure
        id="know-why-missing"
        title="What was missing or contested in the data"
        summary={
          envelope.missingMetrics.length === 0 && envelope.normalizationWarnings.length === 0
            ? "Nothing was missing"
            : `${envelope.missingMetrics.length} missing, ${envelope.normalizationWarnings.length} warning${envelope.normalizationWarnings.length === 1 ? "" : "s"}`
        }
      >
        {envelope.missingMetrics.length === 0 ? (
          <p className="trace-list__empty">
            Every figure this analysis needs was present in the filing.
          </p>
        ) : (
          <>
            <h4>Figures we could not find</h4>
            <ul className="plain-list">
              {envelope.missingMetrics.map((metric) => (
                <li key={metric}>{humanizeKey(metric)}</li>
              ))}
            </ul>
            <p className="notice notice--warning">
              A missing figure is left missing. It is never treated as zero and
              never estimated, because a guessed input would be indistinguishable
              from a reported one further down the page.
            </p>
          </>
        )}
        {envelope.normalizationWarnings.length > 0 ? (
          <TableScroll label="Normalization warnings">
            <table className="data-table">
              <caption>Warnings raised while normalizing the filing facts</caption>
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Figure</th>
                  <th scope="col">Year</th>
                  <th scope="col">What happened</th>
                </tr>
              </thead>
              <tbody>
                {envelope.normalizationWarnings.map((warning, index) => (
                  <tr key={`${warning.code}-${warning.metric}-${index}`}>
                    <th scope="row" className="financial-value wrap-anywhere">{warning.code}</th>
                    <td>{warning.metric === null ? "—" : humanizeKey(warning.metric)}</td>
                    <td className="financial-value">{warning.fiscalYear ?? "—"}</td>
                    <td>{warning.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : null}
      </Disclosure>

      <Disclosure
        id="know-why-evidence"
        title="Every filing reference, in full"
        summary={`${envelope.evidence.length} references`}
      >
        <TableScroll label="Filing references">
          <table className="data-table">
            <caption>
              Each reference resolves to one SEC fact: the concept, the unit, the
              value as filed, and what we did to it.
            </caption>
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Concept</th>
                <th scope="col" className="numeric">As filed</th>
                <th scope="col">Transformation</th>
                <th scope="col">Retrieved</th>
                <th scope="col">Open</th>
              </tr>
            </thead>
            <tbody>
              {envelope.evidence.map((reference) => (
                <tr key={reference.evidenceId}>
                  <th scope="row" className="financial-value wrap-anywhere">{reference.evidenceId}</th>
                  <td className="financial-value wrap-anywhere">{reference.xbrlConcept}</td>
                  <td className="numeric financial-value">
                    {reference.rawValue.toLocaleString("en-US")} {reference.unit}
                  </td>
                  <td>{reference.transformation}</td>
                  <td className="financial-value">{formatDateTime(reference.retrievedAt)}</td>
                  <td>
                    <a href={reference.sourceUrl} rel="noreferrer" target="_blank">
                      {reference.filingForm}
                      <span className="visually-hidden"> filing for {reference.xbrlConcept} (opens in a new tab)</span>
                      <span aria-hidden="true"> ↗</span>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Disclosure>

      <Disclosure
        id="know-why-sources"
        title="Go to the primary sources"
        summary="SEC filing and annual report"
        defaultOpen
      >
        <ul className="source-links">
          <li>
            <a href={envelope.latestFiling.documentUrl} rel="noreferrer" target="_blank">
              {envelope.latestFiling.form} for the period ending{" "}
              {formatDate(envelope.latestFiling.periodOfReport)}
              <span aria-hidden="true"> ↗</span>
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
            <span className="financial-value">{envelope.latestFiling.accessionNumber}</span>
          </li>
          <li>
            <a href={envelope.latestFiling.filingIndexUrl} rel="noreferrer" target="_blank">
              SEC EDGAR filing index for the same accession
              <span aria-hidden="true"> ↗</span>
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
            <span className="financial-value">Filed {formatDate(envelope.latestFiling.filingDate)}</span>
          </li>
          <li>
            {envelope.annualReportUrl === null ? (
              <span className="source-links__absent">
                This company does not publish a separate annual-report page we can link to. The SEC
                filing above is the primary source.
              </span>
            ) : (
              <a href={envelope.annualReportUrl} rel="noreferrer" target="_blank">
                Company annual reports and investor filings
                <span aria-hidden="true"> ↗</span>
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            )}
          </li>
        </ul>
      </Disclosure>

      <Disclosure
        id="know-why-provenance"
        title="Versions and how fresh this is"
        summary={`${envelope.methodologyVersion} · ${envelope.analysisVersion}`}
      >
        <dl className="mini-ledger mini-ledger--wide">
          <div>
            <dt>Methodology version</dt>
            <dd className="financial-value">{envelope.methodologyVersion}</dd>
          </div>
          <div>
            <dt>Analysis version</dt>
            <dd className="financial-value">{envelope.analysisVersion}</dd>
          </div>
          <div>
            <dt>Sector starting points version</dt>
            <dd className="financial-value">{baseline.priorVersion}</dd>
          </div>
          <div>
            <dt>Filing data retrieved</dt>
            <dd className="financial-value">{formatDateTime(envelope.dataFreshness.secRetrievedAt)}</dd>
          </div>
          <div>
            <dt>Market price as of</dt>
            <dd className="financial-value">
              {envelope.dataFreshness.marketPriceAsOf === null
                ? "No price retrieved"
                : formatDateTime(envelope.dataFreshness.marketPriceAsOf)}
            </dd>
          </div>
          <div>
            <dt>Latest fiscal period covered</dt>
            <dd className="financial-value">{formatDate(envelope.dataFreshness.latestFiscalPeriodEnd)}</dd>
          </div>
        </dl>
        <p className="notice">{envelope.dataFreshness.cachePolicy}</p>
      </Disclosure>
    </section>
  );
}

function AssumptionsTable({
  assumptions,
  caption,
}: {
  assumptions: DcfAssumptions;
  caption: string;
}) {
  const rows: [string, string][] = [
    [`Growth, years 1 to ${assumptions.stageOneYears}`, formatRate(assumptions.stageOneGrowthRate)],
    [
      `Growth, years ${assumptions.stageOneYears + 1} to ${assumptions.stageOneYears + assumptions.stageTwoYears}`,
      formatRate(assumptions.stageTwoGrowthRate),
    ],
    [
      `Growth after year ${assumptions.stageOneYears + assumptions.stageTwoYears}`,
      formatRate(assumptions.terminalGrowthRate),
    ],
    ["Return investors require each year", formatRate(assumptions.discountRate)],
  ];

  return (
    <TableScroll label={caption}>
      <table className="data-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Assumption</th>
            <th scope="col" className="numeric">Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td className="numeric financial-value">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

function conceptFor(envelope: AnalysisEnvelope, evidenceId: string | undefined): string {
  if (evidenceId === undefined) {
    return "—";
  }
  return envelope.evidence.find((item) => item.evidenceId === evidenceId)?.xbrlConcept ?? "—";
}
