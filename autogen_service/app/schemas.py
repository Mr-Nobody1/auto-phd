from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, Field


class UserInput(BaseModel):
    professorName: str
    university: str
    language: Literal["english", "german", "french", "other"] = "english"
    customLanguage: str | None = None
    fundingStatus: Literal[
        "fully_funded", "partially_funded", "self_funded", "seeking_funding"
    ] = "fully_funded"
    researchInterests: str = ""
    preferredStart: str = "Fall 2026"
    additionalNotes: str = ""
    postingContent: str = ""


@dataclass
class GenerationRequest:
    input: UserInput
    cv_pdf_bytes: bytes
    cv_filename: str | None = None
    context_image_bytes: bytes | None = None
    context_image_content_type: str | None = None
    context_image_filename: str | None = None


class AgentStatus(BaseModel):
    step: int
    name: str
    status: Literal["pending", "running", "complete", "error"]
    currentAction: str
    progress: int = 0
    timeElapsed: int = 0
    output: Any | None = None
    error: str | None = None


class GenerationResult(BaseModel):
    success: bool
    email: dict[str, Any] | None = None
    cvRecommendations: dict[str, Any] | None = None
    motivationLetter: dict[str, Any] | None = None
    researchProposal: dict[str, Any] | None = None
    professorProfile: dict[str, Any] | None = None
    fitAnalysis: dict[str, Any] | None = None
    error: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)
