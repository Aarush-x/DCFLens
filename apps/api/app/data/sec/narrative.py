"""Deterministic, bounded extraction of native 10-K HTML. No model or network."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime
from html.parser import HTMLParser

from app.data.sec.models import FilingDocument

PARSER_VERSION = "10k-paragraphs-v1"
MAX_DOCUMENT_CHARS = 20_000_000
MAX_TEXT_CHARS = 4_000_000
MAX_EXCERPTS = 8
MAX_EXCERPT_CHARS = 900
TOPICS = ("business", "management_discussion", "risks", "governance")
ITEM_TOPICS = {"1": "business", "1A": "risks", "7": "management_discussion",
               "9A": "governance", "10": "governance", "11": "governance",
               "12": "governance", "13": "governance", "14": "governance"}
# Title validation avoids treating ordinary prose such as 'Item 7 is discussed'
# as a boundary. All standard Items, including non-selected ones, end sections.
TITLES = {
    "1": r"business", "1A": r"risk\s+factors", "1B": r"unresolved",
    "1C": r"cybersecurity", "2": r"properties", "3": r"legal",
    "4": r"mine", "5": r"market", "6": r"(?:reserved|selected)",
    "7": r"management", "7A": r"quantitative", "8": r"financial",
    "9": r"changes", "9A": r"controls", "9B": r"other",
    "9C": r"disclosure", "10": r"directors", "11": r"executive",
    "12": r"security", "13": r"certain", "14": r"principal",
    "15": r"exhibits", "16": r"form",
}
HEADING = re.compile(r"(?im)^[ \t]*item\s+(\d{1,2}[ABC]?)\b[.\s:\-–]*")
TERMS = {
    "business": ("segment", "customer", "product", "competition", "subsidiar"),
    "management_discussion": ("liquidity", "cash flow", "capital", "margin", "revenue", "outlook"),
    "risks": ("risk", "depend", "supply", "regulat", "litigation", "uncertain"),
    "governance": ("control", "material weakness", "board", "audit", "compensation", "related", "independen"),
}


@dataclass(frozen=True, slots=True)
class NarrativeExcerpt:
    evidence_id: str
    topic: str
    section: str
    text: str
    source_url: str
    cik: str
    accession_number: str
    filing_form: str
    filing_date: str
    report_date: str
    retrieved_at: datetime
    document_sha256: str
    start_char: int
    end_char: int
    locator: str
    parser_version: str = PARSER_VERSION


@dataclass(frozen=True, slots=True)
class TopicCoverage:
    topic: str
    status: str
    reason: str


@dataclass(frozen=True, slots=True)
class NarrativeContext:
    status: str
    excerpts: tuple[NarrativeExcerpt, ...] = ()
    coverage: tuple[TopicCoverage, ...] = ()
    warnings: tuple[str, ...] = ()
    parser_version: str = PARSER_VERSION


class _VisibleText(HTMLParser):
    """Ignore executable/hidden text; retain paragraph boundaries and inline words."""
    BLOCKS = {"p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "section"}
    VOID = {"br", "hr", "img", "input", "meta", "link", "wbr", "source", "area", "col", "embed", "param"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.stack: list[tuple[str, bool]] = []
        self.size = 0

    def emit(self, value: str):
        self.size += len(value)
        if self.size > MAX_TEXT_CHARS:
            raise ValueError("narrative_text_limit")
        self.parts.append(value)

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        style = re.sub(r"\s+", "", values.get("style") or "").lower()
        hidden = (bool(self.stack and self.stack[-1][1]) or tag in {"script", "style", "head", "ix:hidden"}
                  or "hidden" in values or values.get("aria-hidden") == "true"
                  or "display:none" in style or "visibility:hidden" in style)
        if not hidden and tag in self.BLOCKS:
            self.emit("\n")
        if not hidden and tag in {"td", "th"}:
            self.emit(" ")
        if tag not in self.VOID:
            if len(self.stack) >= 256:
                raise ValueError("narrative_nesting_limit")
            self.stack.append((tag, hidden))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break
        if tag in self.BLOCKS and not (self.stack and self.stack[-1][1]):
            self.emit("\n")

    def handle_data(self, data):
        if not (self.stack and self.stack[-1][1]):
            self.emit(data)


def normalized_text(document: FilingDocument) -> str:
    if len(document.content) > MAX_DOCUMENT_CHARS:
        raise ValueError("narrative_document_limit")
    if "html" not in document.content_type.lower() and not document.content_type.lower().startswith("text/plain"):
        raise ValueError("unsupported_narrative_format")
    parser = _VisibleText()
    parser.feed(document.content)
    parser.close()
    # Locators refer to this versioned normalized text, not raw HTML offsets.
    return "\n".join(line for part in "".join(parser.parts).splitlines()
                     if (line := " ".join(part.split())))


def extract_narrative(document: FilingDocument) -> NarrativeContext:
    text = normalized_text(document)
    digest = hashlib.sha256(document.content.encode()).hexdigest()
    headings = [match for match in HEADING.finditer(text)
                if match[1].upper() in TITLES and re.match(TITLES[match[1].upper()], text[match.end():], re.I)]
    sections: dict[str, tuple[int, int]] = {}
    for index, match in enumerate(headings):
        item = match[1].upper()
        end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
        start = text.find("\n", match.end(), end)
        if start < 0:
            continue
        start += 1
        # TOC entries have little/no body. Prefer the substantive occurrence.
        if end - start >= 100:
            sections[item] = (start, end)
    excerpts: list[NarrativeExcerpt] = []
    coverage: list[TopicCoverage] = []
    for topic in TOPICS:
        candidates: list[tuple[int, str, int, int]] = []
        incorporated = False
        for item, (start, end) in sections.items():
            if ITEM_TOPICS.get(item) != topic:
                continue
            section_text = text[start:end]
            incorporated |= bool(re.search(r"incorporat\w*\s+by\s+reference|proxy\s+statement", section_text, re.I))
            paragraphs = list(re.finditer(r"[^\n]+", section_text))
            for pos, paragraph in enumerate(paragraphs):
                value = paragraph.group()
                if not 80 <= len(value) <= MAX_EXCERPT_CHARS:
                    continue
                if re.search(r"incorporat\w*\s+by\s+reference", value, re.I):
                    # An external-document pointer is coverage metadata, not
                    # substantive evidence for a governance assessment.
                    continue
                a, b = start + paragraph.start(), start + paragraph.end()
                # Include a following qualification where it fits. Never cut a
                # sentence or drop the tail of an oversized paragraph.
                if pos + 1 < len(paragraphs):
                    neighbor = paragraphs[pos + 1]
                    if neighbor.end() - paragraph.start() <= MAX_EXCERPT_CHARS:
                        b = start + neighbor.end()
                score = sum(term in value.lower() for term in TERMS[topic])
                candidates.append((score, item, a, b))
        selected: list[tuple[int, int]] = []
        for _, item, start, end in sorted(candidates, key=lambda row: (-row[0], row[2])):
            if any(start < b and end > a for a, b in selected):
                continue
            fragment = text[start:end]
            identity = f"{PARSER_VERSION}:{document.metadata.accession_number}:{digest}:{start}:{end}"
            evidence_id = "filing_" + hashlib.sha256(identity.encode()).hexdigest()[:24]
            metadata = document.metadata
            excerpts.append(NarrativeExcerpt(
                evidence_id, topic, f"Item {item}", fragment, metadata.filing_url,
                metadata.cik, metadata.accession_number, metadata.filing_form,
                metadata.filing_date, metadata.report_date, document.retrieved_at,
                digest, start, end, f"Item {item}; {PARSER_VERSION} normalized characters [{start},{end})",
            ))
            selected.append((start, end))
            if len(selected) == 2:
                break
        status = "EXCERPTS_SELECTED" if selected else "NOT_FOUND"
        reason = "Limited paragraph sample, not an exhaustive section review." if selected else "No usable section paragraphs found within extraction bounds."
        if incorporated:
            status = "PARTIAL_REFERENCE"
            reason = "Section refers to another document; incorporated material was not retrieved. No adverse inference is justified."
        coverage.append(TopicCoverage(topic, status, reason))
    return NarrativeContext(
        "EXTRACTED" if excerpts else "UNAVAILABLE", tuple(excerpts), tuple(coverage),
        ("Selected native-text paragraphs only; no news, OCR, proxy statement, or Exhibit 21 retrieval.",),
    )
