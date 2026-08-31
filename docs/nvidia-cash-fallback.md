# NVIDIA annual cash fallback

The production NVDA request returned `missing_sec_data` for
`cash_and_short_term_investments` at January 25, 2026. This was a data-coverage
failure, not a failed DCF calculation or a missing market quote.

NVIDIA's [2026 10-K](https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm)
reports cash and equivalents of $10.605 billion and current marketable securities
of $51.951 billion. The latter uses the issuer extension
`nvda:MarketableSecuritiesAndEquitySecuritiesFVNI`, absent from the SEC Company
Facts response. The reported available-for-sale debt-security subtotal is not an
equivalent replacement: it excludes equity securities.

When the current annual cash total is missing for this reviewed issuer, the API
downloads its latest annual filing through the existing bounded SEC client and
reads the two structured inline-XBRL facts. It requires the matching CIK and
annual reporting date, consolidated instantaneous contexts, USD units, supported
numeric formatting and scaling, and unambiguous values. It derives $62.556 billion
and preserves the filing accession, URL, original tag, displayed value, scaled
value and calculation on each evidence reference. AI receives these as
`sec_inline_fact` evidence; prose from the document does not influence the sum.

Existing Company Facts totals are not overwritten. Other issuers do not trigger
this fallback. Missing, conflicting or unsupported facts remain missing; they
are never replaced with zero. The allowlist is intentionally narrow, so a future
tag change or an amendment omitting these facts can still require investigation.
There are no dependency or deployment-configuration changes.

The regression fixtures retain a small subset of the public Company Facts JSON
and a minimal structured-fact excerpt of this filing. Tests reproduce the original
failure, validate provenance and rejection cases, and exercise the API through a
successful valuation with AI and market quotes disabled.
