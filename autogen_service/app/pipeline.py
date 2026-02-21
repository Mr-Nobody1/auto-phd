from __future__ import annotations

import asyncio
import json
import os
import re
import time
from typing import Any, AsyncGenerator

from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.conditions import MaxMessageTermination
from autogen_agentchat.teams import SelectorGroupChat

from .model_client import create_model_client, get_model_settings
from .schemas import GenerationRequest
from .tools.academic_api import search_author_openalex, search_paper_by_title
from .tools.image_context import analyze_context_image
from .tools.web_context import gather_professor_web_context
from .utils.pdf_parse import extract_text_from_pdf_bytes

AGENTS = [
    (1, "CV Parser"),
    (2, "Professor Researcher"),
    (3, "Paper Selector"),
    (4, "Fit Analyzer"),
    (5, "Email Writer"),
    (6, "CV Recommender"),
    (7, "Motivation Letter Writer"),
    (8, "Research Proposal Writer"),
]


def _elapsed_seconds(start_time: float) -> int:
    return max(0, int(time.monotonic() - start_time))


def _build_status(
    *,
    step: int,
    name: str,
    status: str,
    current_action: str,
    start_time: float,
    progress: int = 0,
    output: Any | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "step": step,
        "name": name,
        "status": status,
        "currentAction": current_action,
        "progress": progress,
        "timeElapsed": _elapsed_seconds(start_time),
    }
    if output is not None:
        payload["output"] = output
    if error:
        payload["error"] = error
    return payload


def _extract_json_block(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    if "```" in cleaned:
        cleaned = re.sub(r"^```(?:json)?", "", cleaned)
        cleaned = re.sub(r"```$", "", cleaned)
        cleaned = cleaned.strip()
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        return json.loads(cleaned[start : end + 1])
    raise ValueError("No JSON object found in model output")


def _extract_text_from_result(result: Any) -> str:
    if isinstance(result, str):
        return result

    messages = getattr(result, "messages", None)
    if not messages:
        return str(result)

    for message in reversed(messages):
        content = getattr(message, "content", None)
        if isinstance(content, str) and content.strip():
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    parts.append(item["text"])
                elif isinstance(item, str):
                    parts.append(item)
            joined = "\n".join(p for p in parts if p.strip()).strip()
            if joined:
                return joined
    return str(result)


def _dedupe_strings(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = value.strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(normalized)
    return result


def _normalize_paper(paper: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": str(paper.get("title", "")).strip(),
        "year": int(paper.get("year") or 0),
        "abstract": str(paper.get("abstract", "")).strip(),
        "url": str(paper.get("url", "")).strip(),
        "venue": str(paper.get("venue", "")).strip(),
        "pdfUrl": paper.get("pdfUrl"),
    }


def _normalize_professor_profile(
    profile: dict[str, Any],
    *,
    fallback: dict[str, Any],
    sources: list[str],
) -> dict[str, Any]:
    merged = dict(fallback)
    merged.update(profile or {})

    recent_papers = merged.get("recentPapers") or []
    normalized_papers: list[dict[str, Any]] = []
    for paper in recent_papers:
        if isinstance(paper, dict):
            normalized = _normalize_paper(paper)
            if normalized["title"]:
                normalized_papers.append(normalized)
    if not normalized_papers:
        normalized_papers = fallback.get("recentPapers", [])[:5]

    merged["name"] = str(merged.get("name") or fallback.get("name") or "").strip()
    merged["title"] = str(merged.get("title") or fallback.get("title") or "Professor")
    merged["university"] = str(
        merged.get("university") or fallback.get("university") or ""
    ).strip()
    merged["department"] = str(
        merged.get("department") or fallback.get("department") or "Unknown Department"
    )
    merged["email"] = merged.get("email") or fallback.get("email")
    merged["emailSource"] = merged.get("emailSource") or fallback.get("emailSource")
    merged["researchInterests"] = _dedupe_strings(
        [*fallback.get("researchInterests", []), *(merged.get("researchInterests") or [])]
    )[:8]
    merged["recentPapers"] = normalized_papers[:8]
    merged["currentProjects"] = _dedupe_strings(
        merged.get("currentProjects") or fallback.get("currentProjects") or []
    )[:6]
    merged["labInfo"] = str(merged.get("labInfo") or fallback.get("labInfo") or "Unknown")
    merged["labUrl"] = merged.get("labUrl") or fallback.get("labUrl")
    merged["openPositions"] = merged.get("openPositions") or fallback.get("openPositions")
    merged["sources"] = _dedupe_strings([*sources, *(merged.get("sources") or [])])
    return merged


async def _run_assistant_json(
    *,
    name: str,
    system_message: str,
    task: str,
    model_client: Any,
    default: dict[str, Any],
) -> dict[str, Any]:
    agent = AssistantAgent(
        name=name,
        model_client=model_client,
        system_message=system_message,
    )
    result = await agent.run(task=task)
    text = _extract_text_from_result(result)
    try:
        return _extract_json_block(text)
    except Exception:
        return default


async def _run_assistant_text(
    *,
    name: str,
    system_message: str,
    task: str,
    model_client: Any,
    default: str,
) -> str:
    agent = AssistantAgent(
        name=name,
        model_client=model_client,
        system_message=system_message,
    )
    result = await agent.run(task=task)
    text = _extract_text_from_result(result).strip()
    return text or default


def _parse_motivation_sections(text: str) -> list[dict[str, str]]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    names = [
        "Opening",
        "Academic Background",
        "Research Experience",
        "Research Fit",
        "Program Alignment",
        "Closing",
    ]
    return [
        {"name": names[idx] if idx < len(names) else f"Paragraph {idx + 1}", "content": para}
        for idx, para in enumerate(paragraphs)
    ]


def _parse_research_proposal(text: str) -> dict[str, Any]:
    lines = text.splitlines()
    title = ""
    abstract_lines: list[str] = []
    sections: list[dict[str, str]] = []
    references: list[str] = []
    current_heading = ""
    current_content: list[str] = []

    def flush() -> None:
        nonlocal current_heading, current_content, abstract_lines
        if not current_heading:
            return
        content = "\n".join(current_content).strip()
        if not content:
            return
        if "abstract" in current_heading.lower():
            abstract_lines = [content]
        elif "reference" in current_heading.lower():
            refs = [re.sub(r"^\s*[-*0-9.]+\s*", "", line).strip() for line in content.splitlines()]
            references.extend([r for r in refs if r])
        else:
            sections.append({"heading": current_heading, "content": content})

    for line in lines:
        if not title and line.strip() and not line.strip().startswith("#"):
            title = line.strip()
        match = re.match(r"^#{1,6}\s*(.+?)\s*$", line.strip())
        if match:
            flush()
            current_heading = match.group(1).strip()
            current_content = []
            continue
        current_content.append(line)
    flush()

    if not title:
        title = "Research Proposal"

    abstract = "\n".join(abstract_lines).strip()
    if not abstract:
        maybe_abstract = next(
            (section["content"] for section in sections if "abstract" in section["heading"].lower()),
            "",
        )
        abstract = maybe_abstract

    return {
        "title": title,
        "abstract": abstract,
        "sections": sections,
        "references": _dedupe_strings(references),
        "wordCount": len(text.split()),
    }


def _fuzzy_match_paper_title(
    title: str, candidates: list[dict[str, Any]]
) -> dict[str, Any] | None:
    wanted = title.lower()
    for candidate in candidates:
        candidate_title = str(candidate.get("title", "")).lower()
        if not candidate_title:
            continue
        if wanted in candidate_title or candidate_title in wanted:
            return candidate
    words = [w for w in re.split(r"\s+", wanted) if len(w) > 3]
    best_score = 0.0
    best_candidate: dict[str, Any] | None = None
    for candidate in candidates:
        candidate_title = str(candidate.get("title", "")).lower()
        if not candidate_title:
            continue
        overlap = sum(1 for w in words if w in candidate_title)
        score = overlap / max(len(words), 1)
        if score > best_score:
            best_score = score
            best_candidate = candidate
    if best_candidate and best_score >= 0.45:
        return best_candidate
    return None


async def run_pipeline_stream(
    request: GenerationRequest,
) -> AsyncGenerator[tuple[str, dict[str, Any]], None]:
    start_time = time.monotonic()
    settings = get_model_settings()
    model_client = create_model_client(settings)

    result_payload: dict[str, Any] = {
        "success": False,
        "email": None,
        "cvRecommendations": None,
        "motivationLetter": None,
        "researchProposal": None,
        "professorProfile": None,
        "fitAnalysis": None,
    }

    step_name = {step: name for step, name in AGENTS}
    web_steps_used = 0
    image_context_used = False
    web_sources: list[str] = []

    try:
        cv_text = extract_text_from_pdf_bytes(request.cv_pdf_bytes)
        if not cv_text.strip():
            raise RuntimeError("Could not extract text from CV PDF")

        # Step 1: CV Parser
        yield "status", _build_status(
            step=1,
            name=step_name[1],
            status="running",
            current_action="Analyzing CV structure...",
            start_time=start_time,
        )

        user_profile = await _run_assistant_json(
            name="cv_parser",
            model_client=model_client,
            system_message=(
                "You extract structured CV information. Always return strict JSON with no markdown."
            ),
            task=(
                "Extract structured profile data from this CV text.\n"
                "Return JSON:\n"
                "{\n"
                '  "name": string,\n'
                '  "education": [{"degree": string, "institution": string, "year": number, "gpa": string, "thesis": string}],\n'
                '  "experience": [{"title": string, "organization": string, "dates": string, "description": string, "skills": [string]}],\n'
                '  "publications": [{"title": string, "venue": string, "year": number, "role": "first_author|co_author"}],\n'
                '  "skills": [string],\n'
                '  "summary": string\n'
                "}\n\n"
                f"CV:\n{cv_text[:12000]}"
            ),
            default={
                "name": "Applicant",
                "education": [],
                "experience": [],
                "publications": [],
                "skills": [],
                "summary": "PhD applicant profile extracted from CV.",
            },
        )
        if not user_profile.get("name"):
            user_profile["name"] = "Applicant"

        yield "status", _build_status(
            step=1,
            name=step_name[1],
            status="complete",
            current_action="Extracted profile",
            start_time=start_time,
            progress=100,
            output=user_profile,
        )

        # Step 2: Professor Researcher
        yield "status", _build_status(
            step=2,
            name=step_name[2],
            status="running",
            current_action="Collecting academic profile...",
            start_time=start_time,
        )

        author_profile = await search_author_openalex(
            request.input.professorName, request.input.university
        )
        source_links: list[str] = []
        seed_papers = (author_profile or {}).get("papers") or []

        if author_profile and author_profile.get("source"):
            source_links.append(str(author_profile["source"]))

        image_context: dict[str, Any] = {"available": False}
        if request.context_image_bytes:
            image_context_used = True
            yield "status", _build_status(
                step=2,
                name=step_name[2],
                status="running",
                current_action="Analyzing optional image context...",
                start_time=start_time,
            )
            try:
                image_context = await analyze_context_image(
                    request.context_image_bytes,
                    request.context_image_content_type,
                    request.context_image_filename,
                    api_key=settings.api_key,
                    model=settings.model,
                    base_url=settings.base_url,
                    timeout_seconds=min(45, settings.timeout_seconds),
                )
            except Exception:
                image_context = {"available": False}

        seed_profile = {
            "name": request.input.professorName,
            "title": "Professor",
            "university": request.input.university,
            "department": "Unknown Department",
            "email": None,
            "emailSource": None,
            "researchInterests": [],
            "recentPapers": [
                _normalize_paper(paper) for paper in seed_papers if isinstance(paper, dict)
            ][:8],
            "currentProjects": [],
            "labInfo": "Unknown",
            "labUrl": None,
            "openPositions": None,
            "sources": source_links,
        }

        missing_email = seed_profile["email"] is None
        interest_count = len(seed_profile["researchInterests"])
        paper_count = len(seed_profile["recentPapers"])
        needs_web_context = missing_email or interest_count < 3 or paper_count < 3
        web_context: dict[str, Any] = {"sources": [], "snippets": [], "researchInterests": []}

        if needs_web_context:
            yield "status", _build_status(
                step=2,
                name=step_name[2],
                status="running",
                current_action="Browsing academic web sources...",
                start_time=start_time,
            )
            max_steps = int(os.getenv("WEB_MAX_STEPS", "6"))
            timeout_seconds = int(os.getenv("WEB_TIMEOUT_SECONDS", "90"))
            web_context = await gather_professor_web_context(
                request.input.professorName,
                request.input.university,
                max_steps=max_steps,
                timeout_seconds=timeout_seconds,
                preferred_domains=[],
            )
            web_steps_used = int(web_context.get("webStepsUsed") or 0)
            web_sources = [str(url) for url in web_context.get("sources") or []]

            if web_context.get("email"):
                seed_profile["email"] = web_context["email"]
                seed_profile["emailSource"] = web_sources[0] if web_sources else None
            seed_profile["researchInterests"] = _dedupe_strings(
                [*seed_profile["researchInterests"], *(web_context.get("researchInterests") or [])]
            )[:8]

        async def tool_get_academic_profile() -> dict[str, Any]:
            return author_profile or {}

        async def tool_get_web_context() -> dict[str, Any]:
            return web_context

        async def tool_get_image_context() -> dict[str, Any]:
            return image_context

        context_router = AssistantAgent(
            name="context_router",
            model_client=model_client,
            description="Routes context gathering and checks completeness.",
            system_message=(
                "You are the context router. Decide what evidence is needed to build a reliable "
                "professor profile and coordinate with the researcher."
            ),
        )
        researcher = AssistantAgent(
            name="context_researcher",
            model_client=model_client,
            description="Synthesizes professor profile from tools.",
            tools=[tool_get_academic_profile, tool_get_web_context, tool_get_image_context],
            system_message=(
                "Use available tools to gather context. Produce final JSON only when done."
            ),
        )
        context_team = SelectorGroupChat(
            [context_router, researcher],
            model_client=model_client,
            termination_condition=MaxMessageTermination(8),
        )

        team_task = (
            "Build a professor profile JSON from available tool evidence.\n"
            "Rules:\n"
            "- Use tool_get_image_context if image is available.\n"
            "- Use tool_get_web_context when professor details are incomplete.\n"
            "- Include provenance URLs in sources.\n\n"
            "Return strict JSON with shape:\n"
            "{\n"
            '  "name": string,\n'
            '  "title": string,\n'
            '  "university": string,\n'
            '  "department": string,\n'
            '  "email": string|null,\n'
            '  "emailSource": string|null,\n'
            '  "researchInterests": [string],\n'
            '  "recentPapers": [{"title": string, "year": number, "abstract": string, "url": string, "venue": string, "pdfUrl": string|null}],\n'
            '  "currentProjects": [string],\n'
            '  "labInfo": string,\n'
            '  "labUrl": string|null,\n'
            '  "openPositions": string|null,\n'
            '  "sources": [string]\n'
            "}\n"
        )

        team_result = await context_team.run(task=team_task)
        team_text = _extract_text_from_result(team_result)
        try:
            synthesized_profile = _extract_json_block(team_text)
        except Exception:
            synthesized_profile = {}

        professor_profile = _normalize_professor_profile(
            synthesized_profile,
            fallback=seed_profile,
            sources=[*source_links, *web_sources],
        )

        yield "status", _build_status(
            step=2,
            name=step_name[2],
            status="complete",
            current_action=f"Collected {len(professor_profile['recentPapers'])} papers",
            start_time=start_time,
            progress=100,
            output=professor_profile,
        )

        # Step 3: Paper Selector
        yield "status", _build_status(
            step=3,
            name=step_name[3],
            status="running",
            current_action="Selecting the most relevant papers...",
            start_time=start_time,
        )

        candidate_papers = professor_profile.get("recentPapers", [])
        if not candidate_papers:
            candidate_papers = seed_profile.get("recentPapers", [])

        async def tool_lookup_paper_by_title(
            title: str, keywords: list[str] | None = None
        ) -> dict[str, Any] | None:
            return await search_paper_by_title(title, keywords)

        paper_selector = AssistantAgent(
            name="paper_selector",
            model_client=model_client,
            tools=[tool_lookup_paper_by_title],
            system_message=(
                "Pick papers most relevant to the applicant profile. Use the lookup tool only "
                "if metadata is missing."
            ),
        )
        selection_result = await paper_selector.run(
            task=(
                "Select up to 3 papers to prioritize for fit analysis.\n"
                "Return strict JSON:\n"
                "{\n"
                '  "selectedPapers": [{"title": string, "reason": string, "priority": "high|medium|low", "keywords": [string]}],\n'
                '  "reasoning": string,\n'
                '  "shouldSearchMore": boolean\n'
                "}\n\n"
                f"Applicant research interests: {request.input.researchInterests}\n"
                f"Candidate papers:\n{json.dumps(candidate_papers[:10], ensure_ascii=True)}\n"
            )
        )
        selection_text = _extract_text_from_result(selection_result)
        try:
            selection_json = _extract_json_block(selection_text)
        except Exception:
            selection_json = {"selectedPapers": [], "reasoning": "", "shouldSearchMore": False}

        selected_papers: list[dict[str, Any]] = []
        for choice in selection_json.get("selectedPapers", [])[:3]:
            if not isinstance(choice, dict):
                continue
            matched = _fuzzy_match_paper_title(str(choice.get("title", "")), candidate_papers)
            if matched:
                selected = dict(matched)
                selected["selectionReason"] = choice.get("reason", "Selected for relevance.")
                selected_papers.append(selected)
                continue

            looked_up = await search_paper_by_title(
                str(choice.get("title", "")), choice.get("keywords")
            )
            if looked_up:
                looked_up["selectionReason"] = choice.get("reason", "Found via lookup.")
                selected_papers.append(looked_up)

        if not selected_papers:
            selected_papers = candidate_papers[:3]

        professor_profile["recentPapers"] = selected_papers + [
            p for p in candidate_papers if p not in selected_papers
        ]

        yield "status", _build_status(
            step=3,
            name=step_name[3],
            status="complete",
            current_action=f"Selected {len(selected_papers)} papers",
            start_time=start_time,
            progress=100,
            output={
                "totalDownloaded": len(selected_papers),
                "additionalDownloaded": 0,
                "iterations": 1,
                "papers": [paper.get("title", "") for paper in selected_papers],
            },
        )

        # Step 4: Fit Analyzer
        yield "status", _build_status(
            step=4,
            name=step_name[4],
            status="running",
            current_action="Analyzing applicant-professor fit...",
            start_time=start_time,
        )

        fit_analysis = await _run_assistant_json(
            name="fit_analyzer",
            model_client=model_client,
            system_message="You evaluate fit and return strict JSON.",
            task=(
                "Analyze fit between applicant and professor.\n"
                "Return JSON:\n"
                "{\n"
                '  "overallFit": "high|medium|low",\n'
                '  "keyOverlaps": [string],\n'
                '  "gaps": [string],\n'
                '  "bestPaperToReference": {"title": string, "year": number, "abstract": string, "url": string, "venue": string},\n'
                '  "suggestedAngle": string\n'
                "}\n\n"
                f"Applicant: {json.dumps(user_profile, ensure_ascii=True)}\n"
                f"Professor: {json.dumps(professor_profile, ensure_ascii=True)}\n"
                f"Research interests: {request.input.researchInterests}\n"
                f"Additional notes: {request.input.additionalNotes}\n"
                f"Posting: {request.input.postingContent}\n"
            ),
            default={
                "overallFit": "medium",
                "keyOverlaps": ["Research alignment identified."],
                "gaps": [],
                "bestPaperToReference": selected_papers[0]
                if selected_papers
                else {
                    "title": "Recent research paper",
                    "year": 2025,
                    "abstract": "",
                    "url": "",
                    "venue": "",
                },
                "suggestedAngle": "Applicant background aligns with current lab direction.",
            },
        )

        yield "status", _build_status(
            step=4,
            name=step_name[4],
            status="complete",
            current_action=f"Fit: {fit_analysis.get('overallFit', 'medium')}",
            start_time=start_time,
            progress=100,
            output=fit_analysis,
        )

        # Step 5: Email Writer
        yield "status", _build_status(
            step=5,
            name=step_name[5],
            status="running",
            current_action="Writing personalized email...",
            start_time=start_time,
        )

        email_output = await _run_assistant_json(
            name="email_writer",
            model_client=model_client,
            system_message=(
                "Write specific professor outreach emails. Return strict JSON with no markdown."
            ),
            task=(
                "Generate a 200-250 word PhD outreach email.\n"
                "Return JSON:\n"
                "{\n"
                '  "subjectOptions": [string, string, string],\n'
                '  "body": string,\n'
                '  "wordCount": number,\n'
                '  "referencedPaper": {"title": string, "url": string},\n'
                '  "effectivenessNote": string\n'
                "}\n\n"
                f"Language: {request.input.customLanguage or request.input.language}\n"
                f"Funding status: {request.input.fundingStatus}\n"
                f"Preferred start: {request.input.preferredStart}\n"
                f"Applicant profile: {json.dumps(user_profile, ensure_ascii=True)}\n"
                f"Professor profile: {json.dumps(professor_profile, ensure_ascii=True)}\n"
                f"Fit analysis: {json.dumps(fit_analysis, ensure_ascii=True)}\n"
            ),
            default={
                "subjectOptions": ["PhD inquiry regarding your recent research"],
                "body": "Dear Professor, I am writing to express my interest in your research.",
                "wordCount": 14,
                "referencedPaper": {
                    "title": fit_analysis.get("bestPaperToReference", {}).get("title", ""),
                    "url": fit_analysis.get("bestPaperToReference", {}).get("url", ""),
                },
                "effectivenessNote": "Fallback draft.",
            },
        )
        email_output["wordCount"] = len(str(email_output.get("body", "")).split())
        if not email_output.get("referencedPaper"):
            best_paper = fit_analysis.get("bestPaperToReference", {})
            email_output["referencedPaper"] = {
                "title": best_paper.get("title", ""),
                "url": best_paper.get("url", ""),
            }

        yield "status", _build_status(
            step=5,
            name=step_name[5],
            status="complete",
            current_action=f"{email_output.get('wordCount', 0)} words",
            start_time=start_time,
            progress=100,
            output=email_output,
        )

        # Step 6: CV Recommender
        yield "status", _build_status(
            step=6,
            name=step_name[6],
            status="running",
            current_action="Generating CV recommendations...",
            start_time=start_time,
        )

        cv_recommendations = await _run_assistant_json(
            name="cv_recommender",
            model_client=model_client,
            system_message="Return actionable CV tailoring advice as strict JSON.",
            task=(
                "Provide targeted CV recommendations.\n"
                "Return JSON:\n"
                "{\n"
                '  "updates": [{"section": string, "currentText": string, "suggestedText": string, "reason": string, "priority": "high|medium|low"}],\n'
                '  "keepAsIs": [{"section": string, "reason": string}],\n'
                '  "removeOrDeemphasize": [{"section": string, "reason": string}],\n'
                '  "formatSuggestions": [string]\n'
                "}\n\n"
                f"CV text:\n{cv_text[:10000]}\n"
                f"Applicant profile: {json.dumps(user_profile, ensure_ascii=True)}\n"
                f"Professor profile: {json.dumps(professor_profile, ensure_ascii=True)}\n"
                f"Fit analysis: {json.dumps(fit_analysis, ensure_ascii=True)}\n"
            ),
            default={
                "updates": [],
                "keepAsIs": [],
                "removeOrDeemphasize": [],
                "formatSuggestions": [],
            },
        )
        cv_recommendations["updates"] = cv_recommendations.get("updates") or []
        cv_recommendations["keepAsIs"] = cv_recommendations.get("keepAsIs") or []
        cv_recommendations["removeOrDeemphasize"] = (
            cv_recommendations.get("removeOrDeemphasize") or []
        )
        cv_recommendations["formatSuggestions"] = cv_recommendations.get("formatSuggestions") or []

        yield "status", _build_status(
            step=6,
            name=step_name[6],
            status="complete",
            current_action=f"{len(cv_recommendations['updates'])} updates suggested",
            start_time=start_time,
            progress=100,
            output=cv_recommendations,
        )

        # Step 7: Motivation Letter Writer
        yield "status", _build_status(
            step=7,
            name=step_name[7],
            status="running",
            current_action="Writing motivation letter...",
            start_time=start_time,
        )

        motivation_text = await _run_assistant_text(
            name="motivation_writer",
            model_client=model_client,
            system_message="Write strong academic motivation letters.",
            task=(
                "Write a 600-800 word motivation letter for this application.\n"
                f"Language: {request.input.customLanguage or request.input.language}\n"
                f"Applicant profile: {json.dumps(user_profile, ensure_ascii=True)}\n"
                f"Professor profile: {json.dumps(professor_profile, ensure_ascii=True)}\n"
                f"Fit analysis: {json.dumps(fit_analysis, ensure_ascii=True)}\n"
                f"Email draft: {json.dumps(email_output, ensure_ascii=True)}\n"
                f"Additional notes: {request.input.additionalNotes}\n"
            ),
            default="Motivation letter could not be generated.",
        )
        motivation_output = {
            "letter": motivation_text.strip(),
            "wordCount": len(motivation_text.split()),
            "sections": _parse_motivation_sections(motivation_text),
        }

        yield "status", _build_status(
            step=7,
            name=step_name[7],
            status="complete",
            current_action=f"{motivation_output['wordCount']} words",
            start_time=start_time,
            progress=100,
            output=motivation_output,
        )

        # Step 8: Research Proposal Writer
        yield "status", _build_status(
            step=8,
            name=step_name[8],
            status="running",
            current_action="Drafting research proposal...",
            start_time=start_time,
        )

        proposal_text = await _run_assistant_text(
            name="proposal_writer",
            model_client=model_client,
            system_message="Write rigorous and feasible PhD research proposals.",
            task=(
                "Write a 1500-2000 word research proposal with markdown headings.\n"
                "Required sections: Title, Abstract, Introduction, Research Questions, "
                "Methodology, Expected Contributions, Preliminary Work, References.\n"
                f"Language: {request.input.customLanguage or request.input.language}\n"
                f"Applicant profile: {json.dumps(user_profile, ensure_ascii=True)}\n"
                f"Professor profile: {json.dumps(professor_profile, ensure_ascii=True)}\n"
                f"Fit analysis: {json.dumps(fit_analysis, ensure_ascii=True)}\n"
                f"Research interests: {request.input.researchInterests}\n"
                f"Posting content: {request.input.postingContent}\n"
            ),
            default="Research proposal generation failed.",
        )
        research_proposal = _parse_research_proposal(proposal_text)

        yield "status", _build_status(
            step=8,
            name=step_name[8],
            status="complete",
            current_action=f"{research_proposal['wordCount']} words",
            start_time=start_time,
            progress=100,
            output=research_proposal,
        )

        result_payload.update(
            {
                "success": True,
                "email": email_output,
                "cvRecommendations": cv_recommendations,
                "motivationLetter": motivation_output,
                "researchProposal": research_proposal,
                "professorProfile": professor_profile,
                "fitAnalysis": fit_analysis,
                "meta": {
                    "webStepsUsed": web_steps_used,
                    "imageContextUsed": image_context_used,
                    "sources": _dedupe_strings(
                        [
                            *(professor_profile.get("sources") or []),
                            *web_sources,
                        ]
                    ),
                },
            }
        )
        yield "complete", result_payload
    except Exception as exc:
        yield "error", {"error": str(exc)}
    finally:
        close_method = getattr(model_client, "close", None)
        if close_method:
            maybe_coro = close_method()
            if asyncio.iscoroutine(maybe_coro):
                await maybe_coro
