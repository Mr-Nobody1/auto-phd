from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

OPENALEX_API = "https://api.openalex.org"
DEFAULT_USER_AGENT = "PhDApply-AutoGen/1.0 (mailto:contact@example.com)"


def _inverted_index_to_text(inverted_index: dict[str, list[int]] | None) -> str:
    if not inverted_index:
        return ""

    words: list[tuple[str, int]] = []
    for word, positions in inverted_index.items():
        for pos in positions:
            words.append((word, pos))
    words.sort(key=lambda item: item[1])
    return " ".join(word for word, _ in words)


def _is_valid_pdf_url(url: str | None) -> bool:
    if not url:
        return False
    if not url.startswith("http"):
        return False
    lower = url.lower()
    if lower.endswith(".pdf"):
        return True
    if "arxiv.org/pdf/" in lower:
        return True
    if "/pdf/" in lower or "/pdfs/" in lower:
        return True
    return False


def _normalize_work(work: dict[str, Any]) -> dict[str, Any]:
    pdf_url: str | None = None
    best_oa_location = work.get("best_oa_location") or {}
    primary_location = work.get("primary_location") or {}
    locations = work.get("locations") or []

    if _is_valid_pdf_url(best_oa_location.get("pdf_url")):
        pdf_url = best_oa_location.get("pdf_url")
    elif _is_valid_pdf_url(primary_location.get("pdf_url")):
        pdf_url = primary_location.get("pdf_url")
    else:
        for location in locations:
            candidate = location.get("pdf_url")
            if _is_valid_pdf_url(candidate):
                pdf_url = candidate
                break

    doi = work.get("doi")
    return {
        "title": work.get("title") or "",
        "year": work.get("publication_year") or 0,
        "abstract": _inverted_index_to_text(work.get("abstract_inverted_index")),
        "authors": [
            a.get("author", {}).get("display_name", "")
            for a in (work.get("authorships") or [])
            if a.get("author", {}).get("display_name")
        ],
        "venue": (primary_location.get("source") or {}).get("display_name", ""),
        "citationCount": work.get("cited_by_count") or 0,
        "url": f"https://doi.org/{doi}" if doi else "",
        "pdfUrl": pdf_url,
        "doi": doi,
    }


async def search_author_openalex(
    author_name: str, affiliation: str | None = None
) -> dict[str, Any] | None:
    params = {"search": author_name, "per_page": 10}
    headers = {"Accept": "application/json", "User-Agent": DEFAULT_USER_AGENT}

    async with httpx.AsyncClient(timeout=25.0) as client:
        search_resp = await client.get(f"{OPENALEX_API}/authors", params=params, headers=headers)
        if search_resp.status_code != 200:
            return None

        search_data = search_resp.json()
        candidates = search_data.get("results") or []
        if not candidates:
            return None

        selected = candidates[0]
        if affiliation:
            affiliation_lower = affiliation.lower()
            for candidate in candidates:
                institutions = candidate.get("last_known_institutions") or []
                if any(
                    (inst.get("display_name") or "").lower().find(affiliation_lower) >= 0
                    for inst in institutions
                ):
                    selected = candidate
                    break
                last_known = candidate.get("last_known_institution") or {}
                if affiliation_lower in (last_known.get("display_name") or "").lower():
                    selected = candidate
                    break

        author_id = selected.get("id")
        if not author_id:
            return None

        recent_url = f"{OPENALEX_API}/works"
        recent_params = {
            "filter": f"author.id:{author_id}",
            "sort": "publication_date:desc",
            "per_page": 12,
        }
        cited_params = {
            "filter": f"author.id:{author_id}",
            "sort": "cited_by_count:desc",
            "per_page": 12,
        }

        recent_resp, cited_resp = await client.get(
            recent_url, params=recent_params, headers=headers
        ), await client.get(recent_url, params=cited_params, headers=headers)

        recent_results = (
            (recent_resp.json().get("results") or []) if recent_resp.status_code == 200 else []
        )
        cited_results = (
            (cited_resp.json().get("results") or []) if cited_resp.status_code == 200 else []
        )

    merged: list[dict[str, Any]] = []
    seen_titles: set[str] = set()
    for work in [*recent_results, *cited_results]:
        normalized = _normalize_work(work)
        title_key = normalized["title"].strip().lower()
        if not title_key or title_key in seen_titles:
            continue
        seen_titles.add(title_key)
        merged.append(normalized)

    merged = merged[:12]

    last_known_inst = selected.get("last_known_institution") or {}
    institutions = selected.get("last_known_institutions") or []
    affiliation_name = (
        last_known_inst.get("display_name")
        or (institutions[0].get("display_name") if institutions else None)
        or affiliation
        or "Unknown"
    )

    return {
        "name": selected.get("display_name") or author_name,
        "authorId": author_id,
        "affiliation": affiliation_name,
        "paperCount": selected.get("works_count") or len(merged),
        "citationCount": selected.get("cited_by_count") or 0,
        "hIndex": (selected.get("summary_stats") or {}).get("h_index"),
        "papers": merged,
        "source": f"{OPENALEX_API}/authors/{quote(author_id, safe=':/')}",
    }


async def search_paper_by_title(
    title: str, keywords: list[str] | None = None
) -> dict[str, Any] | None:
    query = title
    if keywords:
        query = f"{title} {' '.join(keywords)}"

    params = {"search": query, "per_page": 8}
    headers = {"Accept": "application/json", "User-Agent": DEFAULT_USER_AGENT}

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(f"{OPENALEX_API}/works", params=params, headers=headers)
        if response.status_code != 200:
            return None
        works = response.json().get("results") or []

    title_words = [w for w in title.lower().split() if len(w) > 3]
    if not title_words:
        title_words = title.lower().split()

    best_candidate: dict[str, Any] | None = None
    best_score = 0.0
    for work in works:
        normalized = _normalize_work(work)
        if not normalized.get("pdfUrl"):
            continue

        candidate_title = (normalized.get("title") or "").lower()
        if not candidate_title:
            continue
        overlap = sum(1 for w in title_words if w in candidate_title)
        score = overlap / max(len(title_words), 1)
        if score > best_score:
            best_score = score
            best_candidate = normalized

    if best_candidate and best_score >= 0.45:
        return best_candidate
    return None
