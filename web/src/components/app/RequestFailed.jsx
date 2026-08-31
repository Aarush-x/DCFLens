import Eyebrow from '../ui/Eyebrow.jsx'
import Card from '../ui/Card.jsx'
import Label from '../ui/Label.jsx'

/* The designed state for a request that failed — see src/lib/failure.js for which
 * failures reach here and which do not.
 *
 * The one thing this screen must never look like is the cannot-value refusal.
 * That state says "we read this company's filings and won't publish a number";
 * this one says "we never got that far". Borrowing the refusal's headline would
 * put a judgement on a company we never actually read.
 *
 * So: --faint headline rather than a verdict colour, no range bar, no checklist,
 * and copy that names OUR failure. The rail stays beside it, because the way out
 * of every one of these is another company.
 */
export default function RequestFailed({ error, ticker }) {
  /* A RequestFailure carries designed copy. A stray Error — a bug in our own
     code, not a failed request — has none, and gets the neutral wording rather
     than being dressed up as a service outage we did not diagnose. */
  const headline = error?.headline ?? 'We couldn’t load this'
  const body = error?.body ?? 'Something went wrong on our side. Try again in a moment.'
  const detail = error?.detail ?? (error?.headline ? null : error?.message ?? null)

  return (
    <div
      data-state="failed"
      data-failure={error?.kind ?? 'unexpected'}
      /* The request id is the only thread back to a server log line. It is not
         shown — a beginner has no use for a hex string — but it is on the element,
         so a failure during judging can still be traced. Same for the code, which
         product non-negotiable #1 keeps off the screen. */
      title={error?.requestId ? `Request ${error.requestId}` : undefined}
      data-request-id={error?.requestId ?? undefined}
      data-error-code={error?.code ?? undefined}
    >
      <Eyebrow>{ticker ? `${ticker} · nothing to show` : 'Nothing to show'}</Eyebrow>
      <h1 className="verdict" style={{ color: 'var(--faint)' }}>{headline}</h1>
      <p style={{ fontSize: 'var(--t-lead)', color: 'var(--dim)', maxWidth: '54ch', lineHeight: 1.55, marginBottom: 34 }}>
        {body}
      </p>

      {detail && (
        <Card variant="box">
          <Label>What the service said</Label>
          <p style={{ color: 'var(--dim)', margin: '10px 0 0', fontSize: 'var(--t-body)', lineHeight: 1.6 }}>
            {detail}
          </p>
        </Card>
      )}
    </div>
  )
}
