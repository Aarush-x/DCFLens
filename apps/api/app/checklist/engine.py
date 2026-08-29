from __future__ import annotations

import math
from collections.abc import Callable, Iterable
from urllib.parse import urlparse

from app.checklist.contract import ORIGINAL_CHECKLIST, assert_original_contract
from app.checklist.models import (
    ChecklistEvaluation,
    ChecklistEvidence,
    ChecklistInput,
    ChecklistItem,
    ChecklistResult,
    ChecklistStatus,
    FilingEvidenceReference,
    SupportingMetric,
)
from app.data.sec.models import EvidenceReference, NormalizationResult, NormalizedFact


class ChecklistInputError(ValueError):
    """Raised when checklist inputs are structurally invalid."""


_FINANCIAL_SECTORS = {"bank", "banking", "financial", "financials"}
_TECHNOLOGY_SECTORS = {"software", "technology"}
_UTILITY_SECTORS = {"utility", "utilities"}


def evaluate_checklist(checklist_input: ChecklistInput) -> ChecklistEvaluation:
    """Evaluate the unchanged ten-item contract without producing an aggregate score."""
    assert_original_contract()
    _validate_input(checklist_input)
    evaluators: tuple[
        Callable[[ChecklistItem, ChecklistInput], ChecklistResult], ...
    ] = (
        _gross_margin,
        _revenue_growth,
        _eps_consistency,
        _debt_level,
        _inventory,
        _sales_receivables,
        _operating_cash_flow,
        _return_on_equity,
        _business_diversity,
        _subsidiaries,
    )
    results = tuple(
        evaluator(item, checklist_input)
        for item, evaluator in zip(ORIGINAL_CHECKLIST, evaluators, strict=True)
    )
    return ChecklistEvaluation(results=results)


def _validate_input(checklist_input: ChecklistInput) -> None:
    if not checklist_input.sector.strip():
        raise ChecklistInputError("sector must be a non-empty string")
    if not checklist_input.business_type.strip():
        raise ChecklistInputError("business_type must be a non-empty string")
    qualitative = checklist_input.qualitative
    for name, value in (
        ("business_line_count", qualitative.business_line_count),
        ("subsidiary_count", qualitative.subsidiary_count),
    ):
        if value is not None and (
            isinstance(value, bool) or not isinstance(value, int) or value < 0
        ):
            raise ChecklistInputError(f"{name} must be a non-negative integer")
    if (
        qualitative.business_line_count is not None
        and qualitative.business_lines
        and qualitative.business_line_count != len(qualitative.business_lines)
    ):
        raise ChecklistInputError(
            "business_line_count must match the number of named business_lines"
        )
    for reference in (
        *qualitative.business_diversity_evidence,
        *qualitative.subsidiaries_evidence,
    ):
        for name, value in (
            ("evidence_id", reference.evidence_id),
            ("provider", reference.provider),
            ("cik", reference.cik),
            ("accession_number", reference.accession_number),
            ("filing_form", reference.filing_form),
            ("filing_date", reference.filing_date),
            ("source_url", reference.source_url),
            ("locator", reference.locator),
            ("description", reference.description),
        ):
            if not value.strip():
                raise ChecklistInputError(
                    f"filing evidence {name} must be a non-empty string"
                )
        source = urlparse(reference.source_url)
        hostname = (source.hostname or "").lower()
        if source.scheme != "https" or not (
            hostname == "sec.gov" or hostname.endswith(".sec.gov")
        ):
            raise ChecklistInputError(
                "filing evidence source_url must be a direct HTTPS SEC URL"
            )
        if reference.retrieved_at.tzinfo is None:
            raise ChecklistInputError(
                "filing evidence retrieved_at must be timezone-aware"
            )
    for metric, facts in checklist_input.normalized_facts.facts.items():
        for fact in facts:
            if not math.isfinite(fact.value):
                raise ChecklistInputError(
                    f"normalized metric {metric} contains a non-finite value"
                )


def _gross_margin(item: ChecklistItem, data: ChecklistInput) -> ChecklistResult:
    aligned = _aligned(data.normalized_facts, "revenue", "gross_profit")
    sector_context = _sector_context(data, item.number)
    if not aligned:
        return _unknown(
            item,
            data,
            "Gross margin cannot be evaluated because aligned revenue and gross profit are unavailable.",
            "Requires gross_profit / revenue for the same annual period; no qualifying pair was found.",
            ("aligned annual revenue", "aligned annual gross profit"),
            sector_context,
            "Gross margin can affect sustainable FCF margins and terminal economics, but no valuation inference is made without the ratio.",
        )
    revenue, gross_profit = aligned[0]
    if revenue.value <= 0:
        return _unknown(
            item,
            data,
            "Gross margin is not meaningful because reported revenue is not positive.",
            f"Revenue for {revenue.period_end} is {revenue.value}; division was not performed.",
            ("positive annual revenue",),
            sector_context,
            "An unavailable margin should not change forecast margins.",
            evidence=_evidence((revenue, gross_profit)),
        )
    margin = gross_profit.value / revenue.value
    status = (
        ChecklistStatus.SUPPORTS if margin > 0.20 else ChecklistStatus.WEAKENS
    )
    return _result(
        item,
        status,
        f"Gross profit margin is {margin:.1%}; the checklist threshold is strictly above 20%.",
        f"gross_profit_margin = {gross_profit.value} / {revenue.value} = {margin:.10f}; status uses margin > 0.20.",
        "This item applies to every company because the original checklist requires the threshold to be evaluated.",
        (_metric("gross_profit_margin", margin, "decimal_ratio", "gross profit / revenue", (gross_profit, revenue)),),
        _evidence((gross_profit, revenue)),
        (),
        sector_context,
        "Gross margin informs potential operating cash-flow capacity, but it is not treated as proof of a moat or inserted directly into the DCF.",
    )


def _revenue_growth(item: ChecklistItem, data: ChecklistInput) -> ChecklistResult:
    aligned = _aligned(data.normalized_facts, "revenue", "gross_profit")
    sector_context = _sector_context(data, item.number)
    if len(aligned) < 2:
        return _unknown(
            item,
            data,
            "Revenue growth cannot be compared with gross profit growth because two aligned annual periods are unavailable.",
            "Two common period ends with revenue and gross profit are required.",
            ("two aligned annual revenue facts", "two aligned annual gross profit facts"),
            sector_context,
            "Growth alignment may inform forecast credibility; missing alignment does not alter baseline growth.",
            evidence=_evidence(fact for row in aligned for fact in row),
        )
    (revenue_now, gross_now), (revenue_prior, gross_prior) = aligned[:2]
    revenue_growth = _change(revenue_now.value, revenue_prior.value)
    gross_growth = _change(gross_now.value, gross_prior.value)
    if revenue_growth is None or gross_growth is None:
        return _unknown(
            item,
            data,
            "Growth alignment is unavailable because a comparison-period value is zero.",
            "Normalized change divides by the absolute prior value; a zero denominator is not coerced.",
            ("non-zero prior revenue", "non-zero prior gross profit"),
            sector_context,
            "Unusable growth comparisons should not change DCF growth assumptions.",
            evidence=_evidence((revenue_now, gross_now, revenue_prior, gross_prior)),
        )
    gap = abs(revenue_growth - gross_growth)
    if gap <= 0.05 and revenue_growth >= 0 and gross_growth >= 0:
        status = ChecklistStatus.SUPPORTS
    elif gap <= 0.10 or (revenue_growth < 0 and gross_growth < 0):
        status = ChecklistStatus.MONITOR
    else:
        status = ChecklistStatus.WEAKENS
    facts = (revenue_now, revenue_prior, gross_now, gross_prior)
    return _result(
        item,
        status,
        f"Revenue changed {revenue_growth:.1%} while gross profit changed {gross_growth:.1%}; their growth-rate gap is {gap:.1%}.",
        "Normalized changes use (latest - prior) / abs(prior). A gap through 5 percentage points supports, through 10 points monitors, and a larger gap weakens; two declining measures monitor even when aligned.",
        "Revenue and gross profit growth are comparable for companies reporting both measures.",
        (
            _metric("revenue_growth", revenue_growth, "decimal_rate", "(latest revenue - prior revenue) / abs(prior revenue)", (revenue_now, revenue_prior)),
            _metric("gross_profit_growth", gross_growth, "decimal_rate", "(latest gross profit - prior gross profit) / abs(prior gross profit)", (gross_now, gross_prior)),
            _metric("growth_alignment_gap", gap, "absolute_decimal_rate", "abs(revenue growth - gross profit growth)", facts),
        ),
        _evidence(facts),
        (),
        sector_context,
        "Persistent gross-profit growth below sales growth can pressure projected FCF margins; this result is context, not an automatic assumption adjustment.",
    )


def _eps_consistency(item: ChecklistItem, data: ChecklistInput) -> ChecklistResult:
    aligned = _aligned(
        data.normalized_facts,
        "net_income",
        "diluted_eps",
        "diluted_average_shares",
    )
    sector_context = _sector_context(data, item.number)
    if len(aligned) < 2:
        return _unknown(
            item,
            data,
            "EPS consistency and dilution cannot be evaluated because two aligned annual periods are unavailable.",
            "Requires net income, diluted EPS, and diluted average shares for two common period ends.",
            ("two annual net income facts", "two annual diluted EPS facts", "two annual diluted average share facts"),
            sector_context,
            "Dilution affects per-share value, but missing evidence is not converted into an assumed share change.",
            evidence=_evidence(fact for row in aligned for fact in row),
        )
    (income_now, eps_now, shares_now), (income_prior, eps_prior, shares_prior) = aligned[:2]
    income_growth = _change(income_now.value, income_prior.value)
    eps_growth = _change(eps_now.value, eps_prior.value)
    share_growth = _change(shares_now.value, shares_prior.value)
    if income_growth is None or eps_growth is None or share_growth is None:
        return _unknown(
            item,
            data,
            "EPS consistency cannot be evaluated because at least one comparison-period denominator is zero.",
            "Net income, EPS, and diluted-share changes all require non-zero prior values.",
            ("non-zero prior net income, diluted EPS, and diluted shares",),
            sector_context,
            "Per-share valuation should continue using sourced diluted shares without inferring a trend.",
            evidence=_evidence((income_now, eps_now, shares_now, income_prior, eps_prior, shares_prior)),
        )
    gap = abs(income_growth - eps_growth)
    if (income_growth > 0 >= eps_growth) or (share_growth > 0.05 and eps_growth + 0.05 < income_growth):
        status = ChecklistStatus.WEAKENS
    elif gap <= 0.10 and share_growth <= 0.02:
        status = ChecklistStatus.SUPPORTS
    else:
        status = ChecklistStatus.MONITOR
    facts = (income_now, income_prior, eps_now, eps_prior, shares_now, shares_prior)
    return _result(
        item,
        status,
        f"Net income changed {income_growth:.1%}, diluted EPS changed {eps_growth:.1%}, and diluted average shares changed {share_growth:.1%}.",
        "Changes use (latest - prior) / abs(prior). EPS within 10 percentage points of net-income growth with dilution no greater than 2% supports. Material EPS underperformance or dilution above 5% weakens; intermediate cases monitor.",
        "EPS, net income, and diluted-share consistency applies across sectors when aligned facts exist.",
        (
            _metric("net_income_growth", income_growth, "decimal_rate", "normalized annual change", (income_now, income_prior)),
            _metric("diluted_eps_growth", eps_growth, "decimal_rate", "normalized annual change", (eps_now, eps_prior)),
            _metric("diluted_average_shares_growth", share_growth, "decimal_rate", "normalized annual change", (shares_now, shares_prior)),
            _metric("income_eps_growth_gap", gap, "absolute_decimal_rate", "abs(net income growth - diluted EPS growth)", facts),
        ),
        _evidence(facts),
        (),
        sector_context,
        "Sustained dilution can reduce intrinsic value per share even when enterprise cash flow grows.",
    )


def _debt_level(item: ChecklistItem, data: ChecklistInput) -> ChecklistResult:
    sector_context = _sector_context(data, item.number)
    if _sector(data) in _FINANCIAL_SECTORS:
        return _not_applicable(
            item,
            data,
            "Ordinary corporate debt ratios are not applicable to a bank or financial institution because deposits and borrowings are operating inputs and require regulatory-capital analysis.",
            sector_context,
            "A banking valuation requires capital adequacy, asset quality, liquidity, and funding evidence not represented by this ordinary-company debt rule.",
        )
    debt = data.normalized_facts.latest("total_debt")
    cash = data.normalized_facts.latest("cash_and_short_term_investments")
    fcf = data.normalized_facts.latest("free_cash_flow")
    assets = data.normalized_facts.latest("total_assets")
    if debt is None:
        return _unknown(
            item,
            data,
            "Debt level cannot be evaluated because total debt is unavailable.",
            "A sourced zero is valid, but a missing debt fact is not treated as zero.",
            ("total debt",),
            sector_context,
            "Leverage affects equity value and financial risk; no adjustment is made without debt evidence.",
        )
    evidence_facts = tuple(fact for fact in (debt, cash, fcf, assets) if fact is not None)
    metrics: list[SupportingMetric] = [
        _metric("total_debt", debt.value, debt.unit, "reported or normalized total debt", (debt,))
    ]
    if debt.value == 0:
        status = ChecklistStatus.SUPPORTS
        explanation = "Reported total debt is zero."
        technical = "A sourced zero-debt fact supports the checklist item; missing debt would not."
    elif cash is not None and fcf is not None and fcf.value > 0:
        net_debt = debt.value - cash.value
        ratio = net_debt / fcf.value
        metrics.extend(
            (
                _metric("net_debt", net_debt, debt.unit, "total debt - cash and short-term investments", (debt, cash)),
                _metric("net_debt_to_fcf", ratio, "multiple", "net debt / latest positive FCF", (debt, cash, fcf)),
            )
        )
        status = _threshold_status(ratio, supports_max=2.5, monitor_max=4.0)
        explanation = f"Net debt is {ratio:.2f} times latest positive free cash flow."
        technical = "Net-debt-to-FCF through 2.5x supports, above 2.5x through 4.0x monitors, and above 4.0x weakens."
    elif assets is not None and assets.value > 0:
        ratio = debt.value / assets.value
        metrics.append(_metric("debt_to_assets", ratio, "decimal_ratio", "total debt / total assets", (debt, assets)))
        status = _threshold_status(ratio, supports_max=0.40, monitor_max=0.60)
        explanation = f"Total debt is {ratio:.1%} of total assets; net-debt-to-FCF was unavailable."
        technical = "Debt-to-assets through 40% supports, above 40% through 60% monitors, and above 60% weakens. This is a fallback because positive FCF or cash was unavailable."
    else:
        return _unknown(
            item,
            data,
            "Total debt is available, but cash, positive FCF, and total assets are insufficient for an interpretable leverage ratio.",
            "The engine does not assume missing cash, FCF, or assets are zero.",
            ("cash plus positive FCF, or positive total assets",),
            sector_context,
            "Debt is relevant, but an unsupported leverage multiple must not alter valuation.",
            evidence=_evidence(evidence_facts),
            metrics=tuple(metrics),
        )
    return _result(
        item,
        status,
        explanation,
        technical,
        "Ordinary leverage analysis applies to non-financial operating companies.",
        tuple(metrics),
        _evidence(evidence_facts),
        (),
        sector_context,
        "Higher leverage can raise the discount rate and net-debt deduction, but checklist status does not automatically change either assumption.",
    )


def _inventory(item: ChecklistItem, data: ChecklistInput) -> ChecklistResult:
    sector = _sector(data)
    sector_context = _sector_context(data, item.number)
    if sector in _FINANCIAL_SECTORS or sector in _TECHNOLOGY_SECTORS:
        return _not_applicable(
            item,
            data,
            "Inventory analysis is not applicable to this business type because physical inventory is not a material operating driver.",
            sector_context,
            "No missing inventory value is treated as zero; the item is explicitly not applicable.",
        )
    if sector in _UTILITY_SECTORS and not data.normalized_facts.facts.get("inventory"):
        return _not_applicable(
            item,
            data,
            "Inventory analysis is not applicable because no material inventory fact is reported for this utility example.",
            sector_context,
            "A utility reporting material fuel or materials inventory would be evaluated rather than automatically excluded.",
        )
    aligned = _aligned(data.normalized_facts, "inventory", "net_income", "revenue")
    if len(aligned) < 2:
        return _unknown(
            item,
            data,
            "Inventory growth and PAT margin cannot be evaluated because two aligned annual periods are unavailable.",
            "Requires inventory, net income, and revenue for two common period ends.",
            ("two annual inventory facts", "two annual net income facts", "two annual revenue facts"),
            sector_context,
            "Inventory build can consume working capital and weaken FCF, but missing facts do not imply a build.",
            evidence=_evidence(fact for row in aligned for fact in row),
        )
    (inventory_now, income_now, revenue_now), (inventory_prior, income_prior, revenue_prior) = aligned[:2]
    inventory_growth = _change(inventory_now.value, inventory_prior.value)
    revenue_growth = _change(revenue_now.value, revenue_prior.value)
    if inventory_growth is None or revenue_growth is None or revenue_now.value == 0 or revenue_prior.value == 0:
        return _unknown(
            item,
            data,
            "Inventory or PAT-margin comparison has a zero denominator and was not calculated.",
            "Prior inventory and revenue plus current revenue must be non-zero.",
            ("non-zero prior inventory and revenue", "non-zero current revenue"),
            sector_context,
            "No working-capital inference is made from an invalid ratio.",
            evidence=_evidence((inventory_now, income_now, revenue_now, inventory_prior, income_prior, revenue_prior)),
        )
    margin_now = income_now.value / revenue_now.value
    margin_prior = income_prior.value / revenue_prior.value
    margin_change = margin_now - margin_prior
    growth_gap = inventory_growth - revenue_growth
    if growth_gap <= 0.05 and margin_change >= -0.01:
        status = ChecklistStatus.SUPPORTS
    elif growth_gap > 0.10 and margin_change < -0.01:
        status = ChecklistStatus.WEAKENS
    else:
        status = ChecklistStatus.MONITOR
    facts = (inventory_now, inventory_prior, income_now, income_prior, revenue_now, revenue_prior)
    return _result(
        item,
        status,
        f"Inventory changed {inventory_growth:.1%} versus revenue growth of {revenue_growth:.1%}; PAT margin changed {margin_change:.1%}.",
        "Inventory growth no more than 5 percentage points above revenue with PAT-margin deterioration no worse than 1 point supports. Inventory more than 10 points above revenue while PAT margin falls more than 1 point weakens; otherwise monitor.",
        "Inventory analysis applies because this sector can have material physical inventory.",
        (
            _metric("inventory_growth", inventory_growth, "decimal_rate", "normalized annual change", (inventory_now, inventory_prior)),
            _metric("revenue_growth", revenue_growth, "decimal_rate", "normalized annual change", (revenue_now, revenue_prior)),
            _metric("latest_pat_margin", margin_now, "decimal_ratio", "net income / revenue", (income_now, revenue_now)),
            _metric("pat_margin_change", margin_change, "absolute_decimal_rate", "latest PAT margin - prior PAT margin", facts),
        ),
        _evidence(facts),
        (),
        sector_context,
        "Inventory growing faster than sales can consume working capital and reduce future FCF; this status does not mechanically alter forecasts.",
    )


def _sales_receivables(item: ChecklistItem, data: ChecklistInput) -> ChecklistResult:
    sector_context = _sector_context(data, item.number)
    if _sector(data) in _FINANCIAL_SECTORS:
        return _not_applicable(
            item,
            data,
            "Ordinary sales-versus-receivables analysis is not applicable to a bank because loans and financial receivables are core earning assets rather than trade collection balances.",
            sector_context,
            "Bank asset quality and loan-loss evidence are required instead; they are outside this unchanged checklist item's ordinary metric.",
        )
    aligned = _aligned(data.normalized_facts, "revenue", "receivables")
    if len(aligned) < 2:
        return _unknown(
            item,
            data,
            "Sales and receivables cannot be compared because two aligned annual periods are unavailable.",
            "Requires revenue and receivables for two common period ends.",
            ("two annual revenue facts", "two annual receivables facts"),
            sector_context,
            "Receivables growth can affect cash conversion, but missing facts do not imply poor collections.",
            evidence=_evidence(fact for row in aligned for fact in row),
        )
    (revenue_now, receivables_now), (revenue_prior, receivables_prior) = aligned[:2]
    revenue_growth = _change(revenue_now.value, revenue_prior.value)
    receivables_growth = _change(receivables_now.value, receivables_prior.value)
    if revenue_growth is None or receivables_growth is None:
        return _unknown(
            item,
            data,
            "Sales-versus-receivables growth has a zero comparison denominator and was not calculated.",
            "Prior revenue and prior receivables must be non-zero.",
            ("non-zero prior revenue and receivables",),
            sector_context,
            "An invalid comparison does not change working-capital assumptions.",
            evidence=_evidence((revenue_now, revenue_prior, receivables_now, receivables_prior)),
        )
    gap = receivables_growth - revenue_growth
    if gap <= 0.05:
        status = ChecklistStatus.SUPPORTS
    elif gap <= 0.15:
        status = ChecklistStatus.MONITOR
    else:
        status = ChecklistStatus.WEAKENS
    ocf = data.normalized_facts.latest("operating_cash_flow")
    if ocf is not None and ocf.value <= 0 and status == ChecklistStatus.SUPPORTS:
        status = ChecklistStatus.MONITOR
    facts = tuple(
        fact
        for fact in (revenue_now, revenue_prior, receivables_now, receivables_prior, ocf)
        if fact is not None
    )
    metrics = [
        _metric("revenue_growth", revenue_growth, "decimal_rate", "normalized annual change", (revenue_now, revenue_prior)),
        _metric("receivables_growth", receivables_growth, "decimal_rate", "normalized annual change", (receivables_now, receivables_prior)),
        _metric("receivables_growth_excess", gap, "absolute_decimal_rate", "receivables growth - revenue growth", facts),
    ]
    if ocf is not None:
        metrics.append(_metric("operating_cash_flow", ocf.value, ocf.unit, "latest normalized operating cash flow", (ocf,)))
    return _result(
        item,
        status,
        f"Receivables growth is {gap:.1%} above revenue growth{'; operating cash flow is non-positive' if ocf is not None and ocf.value <= 0 else ''}.",
        "Receivables growth through 5 percentage points above sales supports, above 5 through 15 points monitors, and above 15 points weakens. Non-positive OCF prevents a supporting status.",
        "Trade receivables are a relevant collection indicator for this non-financial operating company.",
        tuple(metrics),
        _evidence(facts),
        (),
        sector_context,
        "Receivables outpacing sales can increase working-capital needs and reduce cash conversion.",
    )


def _operating_cash_flow(item: ChecklistItem, data: ChecklistInput) -> ChecklistResult:
    sector_context = _sector_context(data, item.number)
    ocf = data.normalized_facts.latest("operating_cash_flow")
    if ocf is None:
        return _unknown(
            item,
            data,
            "Operating cash flow cannot be evaluated because the annual fact is unavailable.",
            "Missing operating cash flow is not treated as zero.",
            ("latest annual operating cash flow",),
            sector_context,
            "Operating cash flow is a direct FCF input; missing data can make valuation unavailable.",
        )
    status = ChecklistStatus.SUPPORTS if ocf.value > 0 else ChecklistStatus.WEAKENS
    return _result(
        item,
        status,
        f"Latest annual cash flow from operations is {ocf.value:g} {ocf.unit} and is {'positive' if ocf.value > 0 else 'not positive'}.",
        f"The original rule requires operating_cash_flow > 0; observed value is {ocf.value}.",
        "Positive operating cash flow is evaluated for every sector when the normalized fact exists.",
        (_metric("operating_cash_flow", ocf.value, ocf.unit, "latest normalized annual fact", (ocf,)),),
        _evidence((ocf,)),
        (),
        sector_context,
        "Operating cash flow contributes to FCF, but this checklist result does not replace the normalized FCF calculation.",
    )


def _return_on_equity(item: ChecklistItem, data: ChecklistInput) -> ChecklistResult:
    sector_context = _sector_context(data, item.number)
    aligned = _aligned(data.normalized_facts, "net_income", "stockholders_equity")
    if not aligned:
        return _unknown(
            item,
            data,
            "Return on equity cannot be evaluated because aligned net income and stockholders' equity are unavailable.",
            "ROE requires net income and equity for the same annual period, preferably with prior equity for an average balance.",
            ("annual net income", "current and prior stockholders' equity"),
            sector_context,
            "ROE may contextualize reinvestment quality but is not a DCF input by itself.",
        )
    income_now, equity_now = aligned[0]
    evidence_facts: tuple[NormalizedFact, ...]
    missing: tuple[str, ...] = ()
    distorted = False
    if len(aligned) >= 2:
        _, equity_prior = aligned[1]
        average_equity = (equity_now.value + equity_prior.value) / 2.0
        evidence_facts = (income_now, equity_now, equity_prior)
        calculation = "net income / average(current equity, prior equity)"
        if equity_prior.value != 0:
            equity_change = (equity_now.value - equity_prior.value) / abs(equity_prior.value)
            distorted = equity_change <= -0.20 and income_now.value > 0
        else:
            equity_change = None
    else:
        average_equity = equity_now.value
        evidence_facts = (income_now, equity_now)
        calculation = "net income / ending equity because prior equity is unavailable"
        missing = ("prior stockholders' equity for average-equity ROE",)
        equity_change = None
    if average_equity <= 0:
        return _result(
            item,
            ChecklistStatus.MONITOR,
            "ROE is distorted because average stockholders' equity is not positive.",
            f"Average equity is {average_equity}; division is withheld because negative or zero equity can create misleading ROE.",
            "The original ROE threshold is still evaluated for context, but non-positive equity prevents a meaningful threshold comparison.",
            (_metric("average_stockholders_equity", average_equity, equity_now.unit, calculation, evidence_facts),),
            _evidence(evidence_facts),
            ("positive average stockholders' equity",),
            sector_context,
            "Negative equity can result from losses, distributions, or buybacks and requires balance-sheet review before interpreting valuation quality.",
        )
    roe = income_now.value / average_equity
    if missing:
        status = ChecklistStatus.MONITOR
    elif roe > 0.25 and not distorted:
        status = ChecklistStatus.SUPPORTS
    elif roe > 0.25:
        status = ChecklistStatus.MONITOR
    else:
        status = ChecklistStatus.WEAKENS
    metrics = [
        _metric("return_on_equity", roe, "decimal_ratio", calculation, evidence_facts),
        _metric("average_stockholders_equity", average_equity, equity_now.unit, "average equity denominator", evidence_facts),
    ]
    if equity_change is not None:
        metrics.append(_metric("stockholders_equity_change", equity_change, "decimal_rate", "normalized annual change", evidence_facts))
    caveat = " A material equity contraction may inflate ROE." if distorted else ""
    return _result(
        item,
        status,
        f"Return on equity is {roe:.1%}; the original threshold is strictly above 25%.{caveat}",
        f"ROE = {income_now.value} / {average_equity} = {roe:.10f}. Above 25% supports only with positive average equity, prior-equity coverage, and no greater-than-20% equity contraction distortion.",
        "The original ROE threshold applies to every sector, with sector structure and denominator distortions disclosed.",
        tuple(metrics),
        _evidence(evidence_facts),
        missing,
        sector_context,
        "ROE can inform capital-efficiency context, but buybacks, negative equity, and financial-sector balance sheets can disconnect it from sustainable FCF returns.",
    )


def _business_diversity(item: ChecklistItem, data: ChecklistInput) -> ChecklistResult:
    qualitative = data.qualitative
    sector_context = _sector_context(data, item.number)
    if qualitative.business_line_count is None or not qualitative.business_diversity_evidence:
        missing = []
        if qualitative.business_line_count is None:
            missing.append("validated business-line count")
        if not qualitative.business_diversity_evidence:
            missing.append("Item 1 or segment-disclosure evidence")
        return _unknown(
            item,
            data,
            "Business diversity cannot be assessed from the available validated filing evidence.",
            "A count without filing evidence, or evidence without a validated count, is insufficient.",
            tuple(missing),
            sector_context,
            "Business complexity may affect forecast confidence and sum-of-parts needs; missing evidence does not imply complexity.",
            evidence=qualitative.business_diversity_evidence,
        )
    count = qualitative.business_line_count
    if count <= 2:
        status = ChecklistStatus.SUPPORTS
    elif count == 3:
        status = ChecklistStatus.MONITOR
    else:
        status = ChecklistStatus.WEAKENS
    names = ", ".join(qualitative.business_lines) if qualitative.business_lines else "not separately named"
    metric = _qualitative_metric(
        "business_line_count",
        float(count),
        "count",
        "validated count from Item 1 or segment disclosures",
        qualitative.business_diversity_evidence,
    )
    return _result(
        item,
        status,
        f"Validated filing evidence identifies {count} business line(s): {names}.",
        "One or two lines supports the unchanged preference, three monitors, and more than three weakens. The rule measures complexity, not business quality by itself.",
        "Business-line simplicity is assessed for every sector from validated Item 1 or segment evidence.",
        (metric,),
        qualitative.business_diversity_evidence,
        () if qualitative.business_lines else ("business-line names",),
        sector_context,
        "More business lines can require separate segment assumptions or a sum-of-parts analysis; no valuation discount is automatic.",
    )


def _subsidiaries(item: ChecklistItem, data: ChecklistInput) -> ChecklistResult:
    qualitative = data.qualitative
    sector_context = _sector_context(data, item.number)
    if qualitative.subsidiary_count is None or not qualitative.subsidiaries_evidence:
        missing = []
        if qualitative.subsidiary_count is None:
            missing.append("validated subsidiary count")
        if not qualitative.subsidiaries_evidence:
            missing.append("Exhibit 21 or equivalent subsidiary evidence")
        return _unknown(
            item,
            data,
            "Subsidiary complexity cannot be assessed from the available validated filing evidence.",
            "A count requires Exhibit 21 or equivalent direct filing evidence.",
            tuple(missing),
            sector_context,
            "Structure can affect transparency and consolidation analysis; missing evidence is not evidence of misconduct.",
            evidence=qualitative.subsidiaries_evidence,
        )
    count = qualitative.subsidiary_count
    status = ChecklistStatus.SUPPORTS if count <= 10 else ChecklistStatus.MONITOR
    metric = _qualitative_metric(
        "subsidiary_count",
        float(count),
        "count",
        "validated legal-entity count from Exhibit 21 or equivalent",
        qualitative.subsidiaries_evidence,
    )
    if count <= 10:
        plain = f"The filing evidence identifies {count} subsidiaries, within the prototype low-complexity threshold."
    else:
        plain = f"The filing evidence identifies {count} subsidiaries, so legal-entity complexity should be reviewed. This count is not evidence of siphoning or misconduct."
    return _result(
        item,
        status,
        plain,
        "Ten or fewer subsidiaries supports; more than ten monitors. Count alone never produces an accusation or a WEAKENS status because ownership purpose, jurisdiction, materiality, and related-party evidence are required.",
        "Subsidiary structure is applicable to every issuer when direct filing evidence is available.",
        (metric,),
        qualitative.subsidiaries_evidence,
        (),
        sector_context,
        "Complex structures can increase diligence needs and obscure segment economics, but no valuation penalty follows from count alone.",
    )


def _aligned(
    normalized: NormalizationResult, *metrics: str
) -> tuple[tuple[NormalizedFact, ...], ...]:
    by_metric = {
        metric: {fact.period_end: fact for fact in normalized.facts.get(metric, ())}
        for metric in metrics
    }
    if not by_metric:
        return ()
    common_periods = set.intersection(
        *(set(periods) for periods in by_metric.values())
    )
    return tuple(
        tuple(by_metric[metric][period] for metric in metrics)
        for period in sorted(common_periods, reverse=True)
    )


def _change(latest: float, prior: float) -> float | None:
    if prior == 0:
        return None
    return (latest - prior) / abs(prior)


def _threshold_status(
    value: float, *, supports_max: float, monitor_max: float
) -> ChecklistStatus:
    if value <= supports_max:
        return ChecklistStatus.SUPPORTS
    if value <= monitor_max:
        return ChecklistStatus.MONITOR
    return ChecklistStatus.WEAKENS


def _metric(
    name: str,
    value: float,
    unit: str,
    calculation: str,
    facts: Iterable[NormalizedFact],
) -> SupportingMetric:
    fact_tuple = tuple(facts)
    evidence = _evidence(fact_tuple)
    return SupportingMetric(
        name=name,
        value=value,
        unit=unit,
        fiscal_periods=tuple(dict.fromkeys(fact.period_end for fact in fact_tuple)),
        calculation=calculation,
        evidence_ids=tuple(reference.evidence_id for reference in evidence),
    )


def _qualitative_metric(
    name: str,
    value: float,
    unit: str,
    calculation: str,
    evidence: tuple[FilingEvidenceReference, ...],
) -> SupportingMetric:
    return SupportingMetric(
        name=name,
        value=value,
        unit=unit,
        fiscal_periods=tuple(
            dict.fromkeys(reference.filing_date for reference in evidence)
        ),
        calculation=calculation,
        evidence_ids=tuple(reference.evidence_id for reference in evidence),
    )


def _evidence(facts: Iterable[NormalizedFact]) -> tuple[EvidenceReference, ...]:
    return tuple(
        reference
        for fact in facts
        for reference in fact.evidence
        if reference.evidence_id
    )


def _deduplicate_evidence(
    references: Iterable[ChecklistEvidence],
) -> tuple[ChecklistEvidence, ...]:
    result: list[ChecklistEvidence] = []
    seen: set[str] = set()
    for reference in references:
        if reference.evidence_id not in seen:
            seen.add(reference.evidence_id)
            result.append(reference)
    return tuple(result)


def _result(
    item: ChecklistItem,
    status: ChecklistStatus,
    plain: str,
    technical: str,
    applicability: str,
    metrics: tuple[SupportingMetric, ...],
    evidence: Iterable[ChecklistEvidence],
    missing: tuple[str, ...],
    sector_context: str,
    valuation_relevance: str,
) -> ChecklistResult:
    return ChecklistResult(
        checklist_number=item.number,
        checklist_text=item.text,
        status=status,
        plain_english_explanation=plain,
        technical_explanation=technical,
        applicability_reason=applicability,
        metrics_used=metrics,
        evidence_references=_deduplicate_evidence(evidence),
        missing_information=missing,
        sector_context=sector_context,
        potential_valuation_relevance=valuation_relevance,
    )


def _unknown(
    item: ChecklistItem,
    data: ChecklistInput,
    plain: str,
    technical: str,
    missing: tuple[str, ...],
    sector_context: str,
    valuation_relevance: str,
    *,
    evidence: Iterable[ChecklistEvidence] = (),
    metrics: tuple[SupportingMetric, ...] = (),
) -> ChecklistResult:
    return _result(
        item,
        ChecklistStatus.UNKNOWN,
        plain,
        technical,
        "The item applies, but available evidence is insufficient for a supported conclusion.",
        metrics,
        evidence,
        missing,
        sector_context,
        valuation_relevance,
    )


def _not_applicable(
    item: ChecklistItem,
    data: ChecklistInput,
    reason: str,
    sector_context: str,
    technical: str,
) -> ChecklistResult:
    return _result(
        item,
        ChecklistStatus.NOT_APPLICABLE,
        reason,
        technical,
        reason,
        (),
        (),
        (),
        sector_context,
        "No valuation inference is made from a not-applicable checklist item.",
    )


def _sector(data: ChecklistInput) -> str:
    return data.sector.strip().lower()


def _sector_context(data: ChecklistInput, item_number: int) -> str:
    sector = _sector(data)
    base = f"Sector: {data.sector}; business type: {data.business_type}."
    if sector in _FINANCIAL_SECTORS:
        if item_number == 1:
            return base + " Gross profit is often not a standard bank presentation, but the unchanged 20% item is still evaluated when aligned facts exist."
        if item_number == 8:
            return base + " Bank ROE is balance-sheet and regulatory-capital sensitive and must not be read like industrial-company ROE."
    if sector in _TECHNOLOGY_SECTORS and item_number == 5:
        return base + " A software-led company may have no economically meaningful physical inventory."
    if sector in _UTILITY_SECTORS:
        return base + " Regulated returns, capital intensity, and rate-base economics can make ordinary cross-sector thresholds less comparable."
    if sector in {"healthcare", "retail", "industrials", "industrial"} and item_number == 5:
        return base + " Inventory and margin trends can be material operating and working-capital indicators."
    return base + " The original rule is interpreted with sector context but its text and position are unchanged."
