"""Reviewed issuer-extension fallback for cash missing from Company Facts.

NVIDIA's FY2026 balance sheet presents marketable securities as a current asset
under nvda:MarketableSecuritiesAndEquitySecuritiesFVNI. Company Facts omits that
extension. Do not generalize this mapping to arbitrary investment tags: debt-only
subtotals, noncurrent investments and restricted cash are not equivalent.
"""
from __future__ import annotations

import hashlib
import math
import re
import xml.etree.ElementTree as ET
from dataclasses import replace
from datetime import date

from app.data.sec.errors import SecDataError
from app.data.sec.models import (
    EvidenceReference, FilingDocument, NormalizationResult, NormalizedFact,
)

METRIC = "cash_and_short_term_investments"
CASH = "us-gaap:CashAndCashEquivalentsAtCarryingValue"
ISSUER_SECURITIES = {"0001045810": "nvda:MarketableSecuritiesAndEquitySecuritiesFVNI"}
XBRL = "{http://www.xbrl.org/2003/instance}"
IX = "{http://www.xbrl.org/2013/inlineXBRL}"
XSI = "{http://www.w3.org/2001/XMLSchema-instance}"


def needs_filing_cash(result: NormalizationResult) -> bool:
    latest = result.latest("free_cash_flow")
    return (
        result.cik in ISSUER_SECURITIES
        and latest is not None
        and not any(f.period_end == latest.period_end for f in result.facts.get(METRIC, ()))
    )


def supplement_filing_cash(
    result: NormalizationResult, document: FilingDocument,
) -> NormalizationResult:
    """Fill only a missing annual total; refuse ambiguous or unsupported facts."""
    if not needs_filing_cash(result):
        return result
    latest = result.latest("free_cash_flow")
    assert latest is not None
    metadata = document.metadata
    expected_url = (
        f"https://www.sec.gov/Archives/edgar/data/{int(result.cik)}/"
        f"{metadata.accession_number.replace('-', '')}/{metadata.primary_document}"
    )
    if (
        metadata.cik != result.cik
        or metadata.report_date != latest.period_end
        or metadata.filing_form not in {"10-K", "10-K/A"}
        or metadata.filing_url != expected_url
        or document.retrieved_at.tzinfo is None
    ):
        return result

    # ElementTree does not fetch external resources. Also reject DTD/entity
    # declarations and bound input before parsing untrusted filing markup.
    content = document.content
    if len(content) > 20_000_000 or re.search(r"<!\s*(?:DOCTYPE|ENTITY)\b", content, re.I):
        raise SecDataError("Unsupported inline XBRL document")
    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise SecDataError("Invalid inline XBRL document") from exc

    contexts = {}
    for context in root.iter(f"{XBRL}context"):
        identifier = context.find(f"{XBRL}entity/{XBRL}identifier")
        instant = context.findtext(f"{XBRL}period/{XBRL}instant")
        if (
            identifier is not None
            and identifier.get("scheme") == "http://www.sec.gov/CIK"
            and (identifier.text or "").strip().zfill(10) == result.cik
            and instant == latest.period_end
            and context.find(f"{XBRL}period/{XBRL}startDate") is None
            and context.find(f"{XBRL}entity/{XBRL}segment") is None
            and context.find(f"{XBRL}scenario") is None
        ):
            contexts[context.get("id")] = context
    # Only simple USD units, never USD/shares or an arbitrary unit named 'usd'.
    units = {
        unit.get("id") for unit in root.iter(f"{XBRL}unit")
        if len(unit) == 1 and unit[0].tag == f"{XBRL}measure"
        and (unit[0].text or "").strip() == "iso4217:USD"
    }
    concepts = (CASH, ISSUER_SECURITIES[result.cik])
    candidates: dict[str, list[tuple[float, float, int]]] = {name: [] for name in concepts}
    for element in root.iter(f"{IX}nonFraction"):
        name = element.get("name")
        if (
            name not in candidates or element.get("contextRef") not in contexts
            or element.get("unitRef") not in units
            or element.get(f"{XSI}nil") in {"true", "1"}
            or element.get("sign") not in {None, ""}
            or element.get("format", "").split(":")[-1] != "num-dot-decimal"
            or list(element)  # No continuations, excluded text or nested markup.
            or element.get("continuedAt") is not None
        ):
            continue
        text = (element.text or "").strip()
        if not re.fullmatch(r"(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?", text):
            continue
        try:
            scale = int(element.get("scale", "0"))
            if not -12 <= scale <= 12:
                continue
            raw = float(text.replace(",", ""))
            value = raw * 10 ** scale
        except (ValueError, OverflowError):
            continue
        if math.isfinite(value):
            candidates[name].append((value, raw, scale))

    evidence = []
    values = []
    for concept in concepts:
        observations = candidates[concept]
        if not observations or len({row[0] for row in observations}) != 1:
            return result
        value, raw, scale = observations[0]
        values.append(value)
        fingerprint = f"{result.cik}|{metadata.accession_number}|{concept}|{latest.period_end}|{value}"
        evidence.append(EvidenceReference(
            evidence_id="sec_" + hashlib.sha256(fingerprint.encode()).hexdigest()[:24],
            provider="SEC EDGAR", cik=result.cik,
            accession_number=metadata.accession_number, filing_form=metadata.filing_form,
            filing_date=metadata.filing_date, fiscal_period="FY", xbrl_concept=concept,
            unit="USD", raw_value=raw, normalized_value=value,
            transformation=(
                f"cash_and_short_term_investments = cash_and_cash_equivalents + "
                f"current_marketable_securities; inline XBRL reported_value * 10^{scale}"
            ),
            source_url=metadata.filing_url, retrieved_at=document.retrieved_at,
        ))
    total = sum(values)
    if not math.isfinite(total):
        return result
    cash = NormalizedFact(
        metric=METRIC, fiscal_year=date.fromisoformat(latest.period_end).year,
        fiscal_period="FY", period_start=None, period_end=latest.period_end,
        unit="USD", value=total, quality="calculated", evidence=tuple(evidence),
    )
    facts = dict(result.facts)
    facts[METRIC] = tuple(sorted((*facts.get(METRIC, ()), cash), key=lambda f: f.period_end, reverse=True))
    return replace(
        result, facts=facts,
        missing_metrics=tuple(name for name in result.missing_metrics if name != METRIC),
        warnings=tuple(w for w in result.warnings if not (
            w.metric == METRIC and w.code in {"missing_metric", "incomplete_calculation"}
        )),
    )
