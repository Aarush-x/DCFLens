import { FigureTransition } from "@/components/motion/figure-transition";
import { Reveal } from "@/components/motion/reveal";
import type { AnalysisEnvelope } from "@/lib/analysis-types";
import type { AnalysisView } from "@/lib/analysis-view";
import { formatDateTime, formatUsd } from "@/lib/format";

/**
 * The first thing on the page: the answer, the one estimate, the range around
 * it, and today's price when we have one.
 *
 * The tone class comes from `AnalysisView.tone`, which is derived from evidence
 * strength, disagreement, and fragility — never from the sign of the estimate.
 *
 * It reveals top-down on load — who this is about, then the answer, then the
 * figures behind it — which is the hierarchy the banner is already laid out in.
 * The reveal restates that order; it does not create it.
 */
export function VerdictBanner({
  envelope,
  view,
}: {
  envelope: AnalysisEnvelope;
  view: AnalysisView;
}) {
  const valuation = envelope.analysis.finalValuation;
  const interval = valuation.sensitivityInterval;
  const { price } = view;

  return (
    <section className={`verdict verdict--${view.tone}`} aria-labelledby="verdict-title">
      <Reveal immediate selector=".eyebrow, h1, .verdict__detail, .verdict__figures">
        <p className="eyebrow" data-assembly-step="ticker">
          {envelope.companyName} · <span className="financial-value">{envelope.ticker}</span>
        </p>
        <h1 id="verdict-title">{view.verdict}</h1>
        <p className="verdict__detail">{view.verdictDetail}</p>

        <FigureTransition settleOnReveal={false}>
          <dl className="verdict__figures">
            <div>
              <dt>Today&rsquo;s price</dt>
              <dd className="financial-value">
                {price.isAvailable && price.price !== null
                  ? formatUsd(price.price, price.currency)
                  : "Not available"}
              </dd>
              <p className="verdict__figure-note">
                {price.isAvailable && price.asOf !== null
                  ? `${price.source} · ${formatDateTime(price.asOf)}`
                  : "No market quote was retrieved for this company."}
              </p>
            </div>
            <div>
              <dt>What the filings suggest one share is worth</dt>
              <dd className="financial-value verdict__estimate">
                {formatUsd(valuation.intrinsicValuePerShare, valuation.currency)}
              </dd>
              <p className="verdict__figure-note">
                One estimate, from the assumptions listed under &ldquo;Know why&rdquo;.
              </p>
            </div>
            <div>
              <dt>If those assumptions shift a little</dt>
              <dd className="financial-value">
                {formatUsd(interval.lowerBoundPerShare, valuation.currency)} &ndash;{" "}
                {formatUsd(interval.upperBoundPerShare, valuation.currency)}
              </dd>
              <p className="verdict__figure-note">
                A spread of assumptions, not a forecast and not a probability.
              </p>
            </div>
          </dl>
        </FigureTransition>
      </Reveal>

      <RangeBar
        view={view}
        lower={interval.lowerBoundPerShare}
        upper={interval.upperBoundPerShare}
        value={valuation.intrinsicValuePerShare}
        currency={valuation.currency}
      />

      <p className="verdict__interval">{view.intervalStatement}</p>

      <p className="disclaimer" role="note">
        This is research, not financial advice. Nothing here is a recommendation
        to buy, sell, or hold anything. The estimate is only as good as the
        assumptions it rests on, and those are all listed below.
      </p>
    </section>
  );
}

function RangeBar({
  view,
  lower,
  upper,
  value,
  currency,
}: {
  view: AnalysisView;
  lower: number;
  upper: number;
  value: number;
  currency: string;
}) {
  const span = upper - lower;
  // Clamped to an inset so a price outside the interval still renders a
  // visible marker at the edge rather than half outside the track.
  const position = (candidate: number) =>
    span === 0 ? 50 : Math.min(98.5, Math.max(1.5, ((candidate - lower) / span) * 100));

  const { price } = view;
  const priceIsOutside =
    price.position === "below_interval" || price.position === "above_interval";

  return (
    <figure className="range-bar">
      {/* The graphic repeats figures already stated in words, so it is hidden
          from assistive technology and the caption carries the meaning. */}
      <div className="range-bar__track" aria-hidden="true">
        <span
          className="range-bar__marker range-bar__marker--value"
          style={{ left: `${position(value)}%` }}
        />
        {price.isAvailable && price.price !== null ? (
          <span
            className={`range-bar__marker range-bar__marker--price${priceIsOutside ? " range-bar__marker--clamped" : ""}`}
            style={{ left: `${position(price.price)}%` }}
          />
        ) : null}
      </div>
      <div className="range-bar__ends financial-value" aria-hidden="true">
        <span>{formatUsd(lower, currency)}</span>
        <span>{formatUsd(upper, currency)}</span>
      </div>
      <figcaption>
        {price.isAvailable && price.price !== null
          ? `Estimate ${formatUsd(value, currency)}; price ${formatUsd(price.price, price.currency)}; range ${formatUsd(lower, currency)} to ${formatUsd(upper, currency)}.`
          : `Estimate ${formatUsd(value, currency)}; range ${formatUsd(lower, currency)} to ${formatUsd(upper, currency)}. No market price to place on this scale.`}
      </figcaption>
    </figure>
  );
}
