/* The seven questions a first-time visitor actually arrives with.
 *
 * Landing only, deliberately. The analysis screen answers every one of these
 * *about the company on screen* and answers them better: SourceRecord names the
 * filing, the withheld-verdict state says why there is no word, the unavailable
 * price says which of the six reasons applied. A generic copy of those answers
 * sitting beside the specific ones would be the weaker of the two, and would
 * compete with the verdict for the top of the page (CLAUDE.md: verdict before
 * reasoning). See D-028 for why this is worth building at all now — a real
 * beginner arrives alone, where a judge was talked through it.
 *
 * Native <details>, not a JS accordion: keyboard and screen-reader behaviour for
 * free, works with JS still loading, and honours reduced motion by having no
 * motion to reduce.
 *
 * REFUSAL is open by default. It is the one answer that is a claim about our
 * honesty rather than our mechanics, and it currently only ever surfaces when
 * something breaks — a user who never hits a refusal never learns we do it.
 * Collapsed, it would go unread by exactly the people it should reassure.
 *
 * Two things are deliberately NOT stated in this copy:
 *   - the 5x price-ratio threshold. It lives in plausibility.py and is kept out
 *     of docs/API.md so it can be tuned without a contract change (D-027);
 *     printing it here would create a second copy that goes stale silently.
 *     "Multiples away" says the same thing and survives tuning.
 *   - the quote provider's name. ClosingCta's fine print carries "SEC EDGAR &
 *     Yahoo Finance"; the service actually prefers Alpha Vantage when a key is
 *     set (services/analysis.py:429), so naming one here would be wrong half
 *     the time. The source record on the analysis names what was really used.
 *
 * Jargon rule holds: "discount rate" is the only technical term below and it is
 * glossed in the same sentence, inside a collapsed block, which is exactly where
 * CLAUDE.md permits it.
 */
const QUESTIONS = [
  {
    q: 'Where do these numbers come from?',
    a: [
      `Two places, and we name both. The business figures — the cash the company throws off, what it owes, how many shares exist — are read straight out of its annual report to the SEC, the audited document it is legally required to file.`,
      `The share price comes from an outside market feed. At the foot of every analysis we cite the exact filing we used: the form, the period it covers, the date it was filed, its registration number, and a link to the original. If you want to check our arithmetic against the source, you can.`,
    ],
  },
  {
    q: 'Do I need to know what a DCF is?',
    a: [
      `No. That is the entire point.`,
      `DCF stands for discounted cash flow. It is the standard way professionals work out what a business is worth, and you never have to learn it to use this. The main screen is a verdict, a range, and three sentences about the company in ordinary English. The maths is folded away behind “Why? Show me the math”, and if you open it, it explains itself as it goes.`,
    ],
  },
  {
    q: 'Why a range, and never a single number?',
    a: [
      `Because one number would be a lie about how precisely anyone can know this. A valuation is an answer to “what will this business earn from here”, and nobody knows that exactly — small changes to the assumptions move the answer a lot.`,
      `So we run the calculation three times: once on our central assumptions, then twice more with the growth rate and the discount rate — how much we shave off future cash for the simple fact that it hasn’t arrived yet — nudged a percentage point each way. The range is the spread of those three results. It is not a probability, and we do not dress it up as one. It is an honest picture of how much the answer moves when the inputs do.`,
    ],
  },
  {
    q: 'Why do you sometimes refuse to answer?',
    open: true,
    a: [
      `Because a confident wrong answer is worse than no answer, and this is the one thing most tools of this kind will not do.`,
      `Before the verdict is printed, the analysis has to pass a check that asks a blunt question: do we actually believe this? Some things fail it outright. A company whose recent cash flow is negative, because there is nothing to carry forward. A company our method values at nothing at all. Or an estimate that lands multiples away from what the market is paying, in either direction — at that distance the gap is no longer evidence about the stock, it is evidence about our model, and we would rather say so than dress it up as a screaming bargain.`,
      `When the check fails you still get the range, the reasoning and the sources. You get everything except the one word we have not earned.`,
    ],
  },
  {
    q: 'Why is there sometimes no price on the screen?',
    a: [
      `Because we will not invent one. The price comes from a service outside our control, and there are a handful of ways it can fail to arrive: the symbol is not one it recognises, it is rate-limiting us, it times out, it is down, it returns something we do not trust, or we have switched it off on purpose. When that happens we say which, in plain words, and leave the rest of the page exactly as it was.`,
      `What we never do is fill the hole. No placeholder, no yesterday’s price, no zero, and above all no number worked backwards out of our own valuation — a price derived from our estimate would agree with our estimate every single time, which is precisely what would make it worthless.`,
    ],
  },
  {
    q: 'How current is any of this?',
    a: [
      `Two different clocks, and it is worth knowing which is which.`,
      `The price is roughly live: we hold a quote for about a minute before fetching a fresh one, though a public market feed can still lag the exchange by a few minutes. The business figures are only as current as the company’s most recent annual report, so they can be the better part of a year old. That is not a corner we cut — it is how often a company is actually required to open its books.`,
      `A finished analysis is held for fifteen minutes, so asking twice in a row gives you the same answer rather than a slightly different one.`,
    ],
  },
  {
    q: 'Is this investment advice?',
    a: [
      `No. It is a calculation, and the reasoning behind it, laid out so that you can disagree with it. What you do with your money is yours.`,
    ],
  },
]

export default function Faq() {
  return (
    <section className="sect wrap faq">
      <h2 className="rv">Fair questions.</h2>
      <p className="sub rv">
        Including the two most people never think to ask: where the numbers come from,
        and when we decline to answer.
      </p>

      <div className="qas">
        {QUESTIONS.map(({ q, a, open }, i) => (
          <details className="qa rv" key={q} open={open || undefined}>
            <summary>
              <span className="qn">{String(i + 1).padStart(2, '0')}</span>
              <span className="qt">{q}</span>
              <span className="qc" aria-hidden="true" />
            </summary>
            <div className="qbody">
              {a.map((p) => <p key={p.slice(0, 24)}>{p}</p>)}
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}
