"""Where in the filing a reported figure actually appears.

The evidence drawer offers "Read the filing on SEC.gov". Without an anchor that
link opens a three-hundred-page document at page one and leaves the reader to
find the number themselves -- the "the proof is somewhere in this document"
failure the drawer exists to prevent. Inline XBRL gives every tagged fact an
element id, and SEC serves the primary document as text/html, so the figure we
printed has an address: ``<filing_url>#<id>`` scrolls straight to it.

An anchor is navigation and never a value. Nothing here changes a number. A fact
is anchored only when its concept, period, unit AND magnitude all match a visible
tagged element in the filing we already name, so a wrong anchor cannot be built
out of a near miss; anything unmatched simply gets no anchor and the link keeps
opening the filing exactly as it does today.

Each fact also gets ``filing_highlight`` where we can earn it: the text the figure
is printed as, which the frontend turns into a scroll-to-text-fragment so the
browser paints its own temporary highlight on the number. That directive is only
emitted when the printed string occurs EXACTLY ONCE in the document body, because
a text fragment that fails to match is not merely ignored -- the browser then
discards the element id too and scrolls nowhere. Uniqueness is what makes the
highlight a strict improvement on the plain anchor rather than a gamble against it.

Parsing is streaming (``HTMLParser``, as in ``narrative``) rather than a DOM: the
primary document is bounded at 20MB and building a tree for one would cost more
memory than the service has to spare. Element names are matched on their local
name, because the ``ix``/``xbrli`` prefixes are conventional, not guaranteed.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, replace
from html.parser import HTMLParser

from app.data.sec.models import (
    EvidenceReference,
    FilingDocument,
    NormalizationResult,
    NormalizedFact,
)

MAX_DOCUMENT_CHARS = 20_000_000
ANNUAL_FORMS = {"10-K", "10-K/A"}
MAX_FACTS = 200_000
# An id we will paste into a URL fragment. Anything stranger is dropped rather
# than escaped: a filing that names its facts oddly is not worth a link we cannot
# read back.
ANCHOR_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,127}$")
NUMBER_PATTERN = re.compile(r"^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$")
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_TEXT_CHARS = 4_000_000
# Printed figures, bounded the way a browser bounds a text fragment: a match may
# not begin or end in the middle of a word or a number, so "12,715" inside
# "112,715" is not an occurrence of it.
PRINTED_NUMBER = re.compile(r"(?<![\w,.])\d[\d,]*(?:\.\d+)?(?![\w,.])")
# Text we count but a reader never sees.
INVISIBLE = frozenset({"style", "script", "title"})
# Elements that render as their own box. A browser's text fragment will not match
# across one, and neither will our count: without this, adjacent table cells
# concatenate into "activities111,482" and the figure looks like part of a word.
BLOCKS = frozenset({
    "address", "article", "blockquote", "br", "caption", "dd", "div", "dl", "dt",
    "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li",
    "ol", "p", "pre", "section", "table", "tbody", "td", "tfoot", "th", "thead",
    "tr", "ul",
})
# Company Facts spells units this way; inline XBRL spells them as measures. Both
# halves of the pair have to agree before a fact is considered the same fact.
MEASURES = {"usd": "USD", "shares": "shares", "pure": "pure"}

TEXT_SINKS = frozenset({"identifier", "startdate", "enddate", "instant", "measure"})


def _local(tag: str) -> str:
    return tag.rsplit(":", 1)[-1]


@dataclass(frozen=True, slots=True)
class FilingFact:
    """One numeric fact tagged in the filing body, with the id that reaches it."""

    concept: str
    period_start: str | None
    period_end: str
    unit: str
    value: float
    anchor: str
    #: How the figure is printed in the filing ("111,482"), or None when that
    #: string is not unique in the document and so cannot be safely highlighted.
    highlight: str | None = None

    @property
    def key(self) -> tuple[str, str, str, str]:
        return (self.concept, self.period_start or "", self.period_end, self.unit)


class _FactScanner(HTMLParser):
    """Collect contexts, units and visible numeric facts in one pass.

    Facts inside ``ix:header`` (which is where ``ix:hidden`` lives) are skipped.
    They carry ids like any other, but they are laid out as nothing, so an anchor
    to one scrolls the reader nowhere -- worse than no anchor at all.
    """

    def __init__(self, cik: str) -> None:
        super().__init__(convert_charrefs=True)
        self._cik = cik
        self._header_depth = 0
        self._contexts: dict[str, tuple[str | None, str]] = {}
        self._units: dict[str, str] = {}
        self.facts: list[FilingFact] = []
        self.truncated = False
        # The body text as a reader sees it, which is the haystack a browser's
        # text fragment searches. Bounded like narrative's: past the bound we
        # stop counting and no figure is offered for highlighting, because a
        # partial count could call a repeated number unique.
        self._visible: list[str] = []
        self._visible_size = 0
        self._offsets: list[int] = []
        self._skip_depth = 0

        self._context: dict[str, object] | None = None
        self._unit: dict[str, object] | None = None
        self._fact: dict[str, object] | None = None
        self._sink: list[str] | None = None
        self._sink_name = ""

    # -- element events -----------------------------------------------------

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_starttag(self, tag, attrs):
        name = _local(tag)
        attributes = {key: (value or "") for key, value in attrs}
        self._break(name)
        if name in INVISIBLE:
            self._skip_depth += 1
            return
        if name in {"header", "hidden"}:
            self._header_depth += 1
            return
        if name == "context":
            self._context = {"id": attributes.get("id", ""), "dimensioned": False,
                             "entity": False, "start": None, "end": None}
            return
        if name == "unit":
            self._unit = {"id": attributes.get("id", ""), "measures": [], "divide": False,
                          "numerator": None, "denominator": None, "side": None}
            return
        if self._context is not None:
            if name in {"segment", "scenario"}:
                self._context["dimensioned"] = True
            elif name == "identifier":
                self._context["scheme"] = attributes.get("scheme", "")
                self._begin_sink(name)
            elif name in {"startdate", "enddate", "instant"}:
                self._begin_sink(name)
            return
        if self._unit is not None:
            if name == "divide":
                self._unit["divide"] = True
            elif name == "unitnumerator":
                self._unit["side"] = "numerator"
            elif name == "unitdenominator":
                self._unit["side"] = "denominator"
            elif name == "measure":
                self._begin_sink(name)
            return
        if self._fact is not None:
            # ix:exclude removes part of the displayed text from the reported
            # value. We do not implement that, so the fact is abandoned instead
            # of being read wrongly.
            if name == "exclude":
                self._fact["usable"] = False
            return
        if name == "nonfraction" and not self._header_depth:
            self._fact = {
                "name": attributes.get("name", ""),
                "context": attributes.get("contextref", ""),
                "unit": attributes.get("unitref", ""),
                "scale": attributes.get("scale", "0"),
                "sign": attributes.get("sign", ""),
                "anchor": attributes.get("id", ""),
                "nil": attributes.get("xsi:nil", "") in {"true", "1"},
                "continued": "continuedat" in attributes,
                "usable": True,
                "text": [],
            }
            self._sink = self._fact["text"]
            self._sink_name = "nonfraction"

    def handle_endtag(self, tag):
        name = _local(tag)
        self._break(name)
        if name in INVISIBLE:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if name in {"header", "hidden"}:
            self._header_depth = max(0, self._header_depth - 1)
            return
        if name == self._sink_name and name in TEXT_SINKS:
            self._end_sink(name)
            return
        if name == "context" and self._context is not None:
            self._commit_context()
            return
        if name == "unit" and self._unit is not None:
            self._commit_unit()
            return
        if name == "nonfraction" and self._fact is not None:
            self._commit_fact()

    def handle_data(self, data):
        if self._sink is not None:
            self._sink.append(data)
        # A fact's own digits are part of what the reader sees, so this runs
        # alongside the sink rather than instead of it.
        if not self._header_depth and not self._skip_depth and not self.truncated:
            # Normalised as it arrives, so a chunk's length never changes after
            # the fact and the offsets recorded below stay exact.
            chunk = re.sub(r"\s+", " ", data)
            if self._visible_size + len(chunk) > MAX_TEXT_CHARS:
                self.truncated = True
                return
            self._visible.append(chunk)
            self._visible_size += len(chunk)

    def _break(self, name: str) -> None:
        """Record a box boundary, so two cells never read as one word."""
        if name in BLOCKS and not self._header_depth and not self._skip_depth:
            self._visible.append(" ")
            self._visible_size += 1

    def resolved_facts(self) -> list[FilingFact]:
        """The facts, keeping a highlight only where the browser will land on it.

        A text fragment resolves to the FIRST match in document order, so a figure
        is safe to highlight exactly when the first printed occurrence of that
        string is this fact's own. That is a weaker and more useful test than
        global uniqueness: a number repeated later in the notes still highlights,
        and one the MD&A printed first correctly does not.

        Offsets are recorded as the text streams and resolved in one pass here. A
        filing carries hundreds of facts and megabytes of text; searching per fact
        would be quadratic in both.
        """
        if self.truncated:
            return [replace(fact, highlight=None) for fact in self.facts]
        text = "".join(self._visible)
        first: dict[str, int] = {}
        for match in PRINTED_NUMBER.finditer(text):
            first.setdefault(match.group(), match.start())
        resolved = []
        for fact, end in zip(self.facts, self._offsets):
            printed = fact.highlight or ""
            # The fact's own text ends at `end`; look back just far enough to
            # find it, allowing for whitespace the printed form has stripped.
            window = max(0, end - len(printed) - 8)
            start = text.rfind(printed, window, end) if printed else -1
            if start < 0 or first.get(printed) != start:
                fact = replace(fact, highlight=None)
            resolved.append(fact)
        return resolved

    # -- assembly -----------------------------------------------------------

    def _begin_sink(self, name: str) -> None:
        self._sink = []
        self._sink_name = name

    def _end_sink(self, name: str) -> None:
        text = "".join(self._sink or ()).strip()
        self._sink = None
        self._sink_name = ""
        if self._context is not None:
            if name == "identifier":
                self._context["entity"] = (
                    self._context.get("scheme") == "http://www.sec.gov/CIK"
                    and text.zfill(10) == self._cik
                )
            elif name == "startdate":
                self._context["start"] = text
            elif name in {"enddate", "instant"}:
                self._context["end"] = text
        elif self._unit is not None and name == "measure":
            local = _local(text).lower()
            side = self._unit["side"]
            if side is None:
                self._unit["measures"].append(local)
            else:
                self._unit[side] = local

    def _commit_context(self) -> None:
        context, self._context = self._context, None
        assert context is not None
        end = context["end"]
        start = context["start"]
        if (
            not context["id"]
            or context["dimensioned"]
            or not context["entity"]
            or not isinstance(end, str)
            or not DATE_PATTERN.fullmatch(end)
            or (start is not None and not DATE_PATTERN.fullmatch(str(start)))
        ):
            return
        self._contexts[str(context["id"])] = (start if start else None, end)

    def _commit_unit(self) -> None:
        unit, self._unit = self._unit, None
        assert unit is not None
        if not unit["id"]:
            return
        if unit["divide"]:
            numerator = MEASURES.get(str(unit["numerator"]))
            denominator = MEASURES.get(str(unit["denominator"]))
            if numerator and denominator:
                self._units[str(unit["id"])] = f"{numerator}/{denominator}"
            return
        measures = unit["measures"]
        if len(measures) == 1 and measures[0] in MEASURES:
            self._units[str(unit["id"])] = MEASURES[measures[0]]

    def _commit_fact(self) -> None:
        fact, self._fact = self._fact, None
        self._sink = None
        self._sink_name = ""
        assert fact is not None
        if len(self.facts) >= MAX_FACTS:
            self.truncated = True
            return
        anchor = str(fact["anchor"])
        period = self._contexts.get(str(fact["context"]))
        unit = self._units.get(str(fact["unit"]))
        if (
            not fact["usable"]
            or fact["nil"]
            or fact["continued"]
            or period is None
            or unit is None
            or not ANCHOR_PATTERN.fullmatch(anchor)
            or ":" not in str(fact["name"])
        ):
            return
        printed = "".join(fact["text"]).strip()
        value = _decode(printed, str(fact["scale"]), str(fact["sign"]))
        if value is None:
            return
        self.facts.append(
            FilingFact(
                str(fact["name"]), period[0], period[1], unit, value, anchor, printed
            )
        )
        self._offsets.append(self._visible_size)


def _decode(text: str, scale: str, sign: str) -> float | None:
    """The displayed number, read as the value it stands for."""
    if not NUMBER_PATTERN.fullmatch(text):
        return None
    try:
        exponent = int(scale)
        if not -12 <= exponent <= 12:
            return None
        value = float(text.replace(",", "")) * 10**exponent
    except (ValueError, OverflowError):
        return None
    if not math.isfinite(value):
        return None
    return -value if sign == "-" else value


def _expected_filing_url(cik: str, accession: str, primary_document: str) -> str:
    return (
        f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
        f"{accession.replace('-', '')}/{primary_document}"
    )


def filing_fact_index(
    document: FilingDocument, cik: str
) -> dict[tuple[str, str, str, str], list[FilingFact]]:
    """Every visible numeric fact in the filing, grouped by what identifies it."""
    scanner = _FactScanner(cik)
    scanner.feed(document.content)
    scanner.close()
    index: dict[tuple[str, str, str, str], list[FilingFact]] = {}
    for fact in scanner.resolved_facts():
        index.setdefault(fact.key, []).append(fact)
    return index


def _anchored(
    reference: EvidenceReference,
    fact: NormalizedFact,
    index: dict[tuple[str, str, str, str], list[FilingFact]],
    accession: str,
) -> EvidenceReference:
    if reference.filing_anchor or reference.accession_number != accession:
        return reference
    key = (
        reference.xbrl_concept,
        fact.period_start or "",
        fact.period_end,
        reference.unit,
    )
    for candidate in index.get(key, ()):
        # Magnitude, not signed value: a cash-flow statement prints capital
        # expenditure as a negative and Company Facts stores it as a positive.
        # The same line item either way, which is all an anchor claims.
        if math.isclose(
            abs(candidate.value), abs(reference.raw_value), rel_tol=1e-6, abs_tol=0.5
        ):
            return replace(
                reference,
                filing_anchor=candidate.anchor,
                filing_highlight=candidate.highlight,
            )
    return reference


def annotate_filing_anchors(
    result: NormalizationResult, document: FilingDocument
) -> NormalizationResult:
    """Give every figure taken from this filing the id that scrolls to it.

    Facts sourced from any other filing are left alone: the drawer links to the
    latest filing, and an id from a different document would point at nothing or,
    worse, at a different number that happens to share the id.
    """
    metadata = document.metadata
    if (
        metadata.cik != result.cik
        or metadata.filing_form not in ANNUAL_FORMS
        or metadata.filing_url
        != _expected_filing_url(
            result.cik, metadata.accession_number, metadata.primary_document
        )
        or document.retrieved_at.tzinfo is None
        or len(document.content) > MAX_DOCUMENT_CHARS
    ):
        return result

    index = filing_fact_index(document, result.cik)
    if not index:
        return result

    accession = metadata.accession_number
    facts: dict[str, tuple[NormalizedFact, ...]] = {}
    changed = False
    for metric, items in result.facts.items():
        rebuilt = []
        for fact in items:
            evidence = tuple(
                _anchored(reference, fact, index, accession) for reference in fact.evidence
            )
            if evidence != fact.evidence:
                changed = True
                fact = replace(fact, evidence=evidence)
            rebuilt.append(fact)
        facts[metric] = tuple(rebuilt)
    return replace(result, facts=facts) if changed else result
