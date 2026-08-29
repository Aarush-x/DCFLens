from __future__ import annotations

import json
import math
from collections.abc import Mapping
from typing import Any

from app.ai.models import (
    ClaimType,
    EvidenceSupport,
    RequestedAdjustment,
    RequestedChecklistFinding,
    RequestedEvidenceAssessment,
    ValidatedAiResponse,
)
from app.checklist.models import ChecklistStatus


AI_ADJUSTMENT_BOUNDS: Mapping[str, tuple[float, float]] = {
    "stage_one_growth_rate": (-0.03, 0.03),
    "stage_two_growth_rate": (-0.02, 0.02),
    "discount_rate": (-0.015, 0.015),
}
MAX_PROVIDER_RESPONSE_CHARS = 65_536
MAX_RATIONALE_CHARS = 1_000
MAX_CLAIM_CHARS = 1_500
MAX_EVIDENCE_IDS_PER_CLAIM = 12


GEMINI_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "adjustments": {
            "type": "array",
            "minItems": 3,
            "maxItems": 3,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "assumption": {
                        "type": "string",
                        "enum": list(AI_ADJUSTMENT_BOUNDS),
                    },
                    "adjustment": {
                        "type": "number",
                        "minimum": -0.03,
                        "maximum": 0.03,
                    },
                    "rationale": {"type": "string"},
                    "evidence_ids": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": MAX_EVIDENCE_IDS_PER_CLAIM,
                        "items": {"type": "string"},
                    },
                    "claim_type": {
                        "type": "string",
                        "enum": [ClaimType.ASSUMPTION.value],
                    },
                },
                "required": [
                    "assumption",
                    "adjustment",
                    "rationale",
                    "evidence_ids",
                    "claim_type",
                ],
            },
        },
        "evidence_assessment": {
            "type": "array",
            "minItems": 1,
            "maxItems": 20,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "statement": {"type": "string"},
                    "claim_type": {
                        "type": "string",
                        "enum": [item.value for item in ClaimType],
                    },
                    "support": {
                        "type": "string",
                        "enum": [item.value for item in EvidenceSupport],
                    },
                    "evidence_ids": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": MAX_EVIDENCE_IDS_PER_CLAIM,
                        "items": {"type": "string"},
                    },
                },
                "required": [
                    "statement",
                    "claim_type",
                    "support",
                    "evidence_ids",
                ],
            },
        },
        "checklist_findings": {
            "type": "array",
            "maxItems": 10,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "checklist_number": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 10,
                    },
                    "status": {
                        "type": "string",
                        "enum": [item.value for item in ChecklistStatus],
                    },
                    "explanation": {"type": "string"},
                    "evidence_ids": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": MAX_EVIDENCE_IDS_PER_CLAIM,
                        "items": {"type": "string"},
                    },
                    "claim_type": {
                        "type": "string",
                        "enum": [ClaimType.INTERPRETATION.value],
                    },
                },
                "required": [
                    "checklist_number",
                    "status",
                    "explanation",
                    "evidence_ids",
                    "claim_type",
                ],
            },
        },
        "disagreement_summary": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "summary": {"type": "string"},
                "evidence_ids": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_EVIDENCE_IDS_PER_CLAIM,
                    "items": {"type": "string"},
                },
            },
            "required": ["summary", "evidence_ids"],
        },
    },
    "required": [
        "adjustments",
        "evidence_assessment",
        "checklist_findings",
        "disagreement_summary",
    ],
}


class AiResponseValidationError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def parse_and_validate_ai_response(
    response_text: str,
    available_evidence_ids: frozenset[str],
) -> ValidatedAiResponse:
    if not isinstance(response_text, str) or not response_text.strip():
        raise AiResponseValidationError("empty_response", "AI response is empty")
    if len(response_text) > MAX_PROVIDER_RESPONSE_CHARS:
        raise AiResponseValidationError(
            "response_too_large", "AI response exceeds the maximum allowed size"
        )
    try:
        raw = json.loads(response_text)
    except json.JSONDecodeError as exc:
        raise AiResponseValidationError(
            "malformed_json", "AI response is not valid JSON"
        ) from exc
    root = _exact_object(
        raw,
        "response",
        {
            "adjustments",
            "evidence_assessment",
            "checklist_findings",
            "disagreement_summary",
        },
    )

    adjustments_raw = _array(root["adjustments"], "adjustments", exact_length=3)
    adjustments = tuple(
        _parse_adjustment(item, index, available_evidence_ids)
        for index, item in enumerate(adjustments_raw)
    )
    assumptions = tuple(item.assumption for item in adjustments)
    if len(set(assumptions)) != 3 or set(assumptions) != set(AI_ADJUSTMENT_BOUNDS):
        raise AiResponseValidationError(
            "invalid_adjustment_set",
            "AI response must contain each allowed assumption exactly once",
        )

    assessments_raw = _array(
        root["evidence_assessment"],
        "evidence_assessment",
        minimum=1,
        maximum=20,
    )
    assessments = tuple(
        _parse_evidence_assessment(item, index, available_evidence_ids)
        for index, item in enumerate(assessments_raw)
    )

    findings_raw = _array(
        root["checklist_findings"],
        "checklist_findings",
        minimum=0,
        maximum=10,
    )
    findings = tuple(
        _parse_checklist_finding(item, index, available_evidence_ids)
        for index, item in enumerate(findings_raw)
    )
    finding_numbers = tuple(item.checklist_number for item in findings)
    if len(set(finding_numbers)) != len(finding_numbers):
        raise AiResponseValidationError(
            "duplicate_checklist_item",
            "AI checklist findings must not repeat a checklist number",
        )

    disagreement = _exact_object(
        root["disagreement_summary"],
        "disagreement_summary",
        {"summary", "evidence_ids"},
    )
    summary = _string(
        disagreement["summary"], "disagreement_summary.summary", MAX_CLAIM_CHARS
    )
    disagreement_evidence = _evidence_ids(
        disagreement["evidence_ids"],
        "disagreement_summary.evidence_ids",
        available_evidence_ids,
    )
    return ValidatedAiResponse(
        adjustments=tuple(sorted(adjustments, key=_adjustment_order)),
        evidence_assessment=assessments,
        checklist_findings=tuple(sorted(findings, key=lambda item: item.checklist_number)),
        disagreement_summary=summary,
        disagreement_evidence_ids=disagreement_evidence,
    )


def _parse_adjustment(
    raw: object,
    index: int,
    available_evidence_ids: frozenset[str],
) -> RequestedAdjustment:
    path = f"adjustments[{index}]"
    item = _exact_object(
        raw,
        path,
        {"assumption", "adjustment", "rationale", "evidence_ids", "claim_type"},
    )
    assumption = _string(item["assumption"], f"{path}.assumption", 64)
    if assumption not in AI_ADJUSTMENT_BOUNDS:
        raise AiResponseValidationError(
            "forbidden_assumption", f"{path}.assumption cannot be adjusted"
        )
    adjustment = _number(item["adjustment"], f"{path}.adjustment")
    lower, upper = AI_ADJUSTMENT_BOUNDS[assumption]
    if not lower <= adjustment <= upper:
        raise AiResponseValidationError(
            "excessive_adjustment",
            f"{path}.adjustment must be between {lower} and {upper}",
        )
    claim_type = _enum(
        ClaimType, item["claim_type"], f"{path}.claim_type"
    )
    if claim_type is not ClaimType.ASSUMPTION:
        raise AiResponseValidationError(
            "invalid_claim_type", f"{path}.claim_type must be ASSUMPTION"
        )
    return RequestedAdjustment(
        assumption=assumption,
        adjustment=adjustment,
        rationale=_string(item["rationale"], f"{path}.rationale", MAX_RATIONALE_CHARS),
        evidence_ids=_evidence_ids(
            item["evidence_ids"], f"{path}.evidence_ids", available_evidence_ids
        ),
        claim_type=claim_type,
    )


def _parse_evidence_assessment(
    raw: object,
    index: int,
    available_evidence_ids: frozenset[str],
) -> RequestedEvidenceAssessment:
    path = f"evidence_assessment[{index}]"
    item = _exact_object(
        raw, path, {"statement", "claim_type", "support", "evidence_ids"}
    )
    return RequestedEvidenceAssessment(
        statement=_string(item["statement"], f"{path}.statement", MAX_CLAIM_CHARS),
        claim_type=_enum(ClaimType, item["claim_type"], f"{path}.claim_type"),
        support=_enum(EvidenceSupport, item["support"], f"{path}.support"),
        evidence_ids=_evidence_ids(
            item["evidence_ids"], f"{path}.evidence_ids", available_evidence_ids
        ),
    )


def _parse_checklist_finding(
    raw: object,
    index: int,
    available_evidence_ids: frozenset[str],
) -> RequestedChecklistFinding:
    path = f"checklist_findings[{index}]"
    item = _exact_object(
        raw,
        path,
        {
            "checklist_number",
            "status",
            "explanation",
            "evidence_ids",
            "claim_type",
        },
    )
    number = item["checklist_number"]
    if isinstance(number, bool) or not isinstance(number, int) or not 1 <= number <= 10:
        raise AiResponseValidationError(
            "invalid_checklist_number", f"{path}.checklist_number must be 1 through 10"
        )
    claim_type = _enum(ClaimType, item["claim_type"], f"{path}.claim_type")
    if claim_type is not ClaimType.INTERPRETATION:
        raise AiResponseValidationError(
            "invalid_claim_type", f"{path}.claim_type must be INTERPRETATION"
        )
    return RequestedChecklistFinding(
        checklist_number=number,
        status=_enum(ChecklistStatus, item["status"], f"{path}.status"),
        explanation=_string(
            item["explanation"], f"{path}.explanation", MAX_CLAIM_CHARS
        ),
        evidence_ids=_evidence_ids(
            item["evidence_ids"], f"{path}.evidence_ids", available_evidence_ids
        ),
        claim_type=claim_type,
    )


def _exact_object(
    raw: object, path: str, required_fields: set[str]
) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise AiResponseValidationError("invalid_type", f"{path} must be an object")
    keys = set(raw)
    if keys != required_fields:
        missing = sorted(required_fields - keys)
        unexpected = sorted(keys - required_fields)
        raise AiResponseValidationError(
            "invalid_fields",
            f"{path} has missing fields {missing} and unexpected fields {unexpected}",
        )
    return raw


def _array(
    raw: object,
    path: str,
    *,
    exact_length: int | None = None,
    minimum: int = 0,
    maximum: int | None = None,
) -> list[Any]:
    if not isinstance(raw, list):
        raise AiResponseValidationError("invalid_type", f"{path} must be an array")
    if exact_length is not None and len(raw) != exact_length:
        raise AiResponseValidationError(
            "invalid_length", f"{path} must contain exactly {exact_length} items"
        )
    if len(raw) < minimum or (maximum is not None and len(raw) > maximum):
        raise AiResponseValidationError(
            "invalid_length", f"{path} has an invalid number of items"
        )
    return raw


def _string(raw: object, path: str, maximum: int) -> str:
    if not isinstance(raw, str):
        raise AiResponseValidationError("invalid_type", f"{path} must be a string")
    value = raw.strip()
    if not value or len(value) > maximum:
        raise AiResponseValidationError(
            "invalid_string", f"{path} must contain 1 through {maximum} characters"
        )
    return value


def _number(raw: object, path: str) -> float:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise AiResponseValidationError("invalid_type", f"{path} must be a number")
    value = float(raw)
    if not math.isfinite(value):
        raise AiResponseValidationError("non_finite", f"{path} must be finite")
    return value


def _enum(enum_type: type[Any], raw: object, path: str) -> Any:
    if not isinstance(raw, str):
        raise AiResponseValidationError("invalid_type", f"{path} must be a string")
    try:
        return enum_type(raw)
    except ValueError as exc:
        raise AiResponseValidationError(
            "invalid_enum", f"{path} contains an unsupported value"
        ) from exc


def _evidence_ids(
    raw: object,
    path: str,
    available_evidence_ids: frozenset[str],
) -> tuple[str, ...]:
    values = _array(
        raw, path, minimum=1, maximum=MAX_EVIDENCE_IDS_PER_CLAIM
    )
    result: list[str] = []
    for index, value in enumerate(values):
        evidence_id = _string(value, f"{path}[{index}]", 128)
        if evidence_id not in available_evidence_ids:
            raise AiResponseValidationError(
                "unknown_evidence_id",
                f"{path}[{index}] cites evidence that was not supplied",
            )
        if evidence_id not in result:
            result.append(evidence_id)
    return tuple(result)


def _adjustment_order(item: RequestedAdjustment) -> int:
    return tuple(AI_ADJUSTMENT_BOUNDS).index(item.assumption)
