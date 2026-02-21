from __future__ import annotations

import json
from typing import AsyncGenerator

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError
from dotenv import load_dotenv

load_dotenv()


from .pipeline import run_pipeline_stream
from .schemas import GenerationRequest, UserInput

app = FastAPI(title="PhDApply AutoGen Service", version="0.1.0")


def _sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/generate")
async def generate(
    professorName: str = Form(...),
    university: str = Form(...),
    language: str = Form("english"),
    customLanguage: str = Form(""),
    fundingStatus: str = Form("fully_funded"),
    researchInterests: str = Form(""),
    preferredStart: str = Form("Fall 2026"),
    additionalNotes: str = Form(""),
    postingContent: str = Form(""),
    cvFile: UploadFile = File(...),
    contextImage: UploadFile | None = File(None),
):
    if not professorName.strip() or not university.strip():
        return JSONResponse(
            {"error": "Professor name and university are required"}, status_code=400
        )
    if not cvFile:
        return JSONResponse({"error": "CV file is required"}, status_code=400)

    cv_bytes = await cvFile.read()
    if not cv_bytes:
        return JSONResponse({"error": "CV file is empty"}, status_code=400)

    image_bytes: bytes | None = None
    image_type: str | None = None
    image_filename: str | None = None
    if contextImage:
        image_bytes = await contextImage.read()
        image_type = contextImage.content_type
        image_filename = contextImage.filename

    try:
        user_input = UserInput(
            professorName=professorName.strip(),
            university=university.strip(),
            language=language.strip().lower(),
            customLanguage=customLanguage.strip() or None,
            fundingStatus=fundingStatus.strip().lower(),
            researchInterests=researchInterests.strip(),
            preferredStart=preferredStart.strip() or "Fall 2026",
            additionalNotes=additionalNotes.strip(),
            postingContent=postingContent.strip(),
        )
    except ValidationError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)

    request = GenerationRequest(
        input=user_input,
        cv_pdf_bytes=cv_bytes,
        cv_filename=cvFile.filename,
        context_image_bytes=image_bytes,
        context_image_content_type=image_type,
        context_image_filename=image_filename,
    )

    async def stream() -> AsyncGenerator[str, None]:
        try:
            async for event, payload in run_pipeline_stream(request):
                yield _sse_event(event, payload)
        except Exception as exc:
            yield _sse_event("error", {"error": str(exc)})

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(stream(), media_type="text/event-stream", headers=headers)
