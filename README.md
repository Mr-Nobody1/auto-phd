# PhDApply - AutoGen Edition

PhDApply now runs with a **Microsoft AutoGen Python backend** for orchestration and a **Node/Hono frontend gateway** for UI and SSE proxying.

## Architecture

- `server/index.ts`: serves frontend and proxies `/api/generate` SSE to Python service
- `autogen_service/app/main.py`: FastAPI AutoGen service (`/generate`)
- `autogen_service/app/pipeline.py`: 8-step AutoGen pipeline (same status/event contract)
- `public/*`: unchanged UI flow with an added optional image context upload

## Features

- 8-step autonomous agent pipeline (same UI progress steps)
- Optional image context (`contextImage`) for additional signal
- Autonomous web context retrieval with bounded steps/timeouts
- Academic API context (OpenAlex)
- No DB or persistent memory usage (request-scoped in-memory only)

## Prerequisites

- Node.js 18+
- Python 3.11+
- `GEMINI_API_KEY`

## Setup

1. Install Node dependencies:

```bash
npm install
```

2. Install Python dependencies:

```bash
pip install -e ./autogen_service --no-build-isolation
```

3. Configure environment:

```bash
cp .env.example .env
```

Set at least:

- `GEMINI_API_KEY`
- `GEMINI_OPENAI_BASE_URL`
- `AUTOGEN_MODEL`
- `AUTOGEN_SERVICE_URL`

## Run

Run both services together:

```bash
npm run dev
```

Run individually:

```bash
npm run dev:node
npm run dev:py
```

Open:

- `http://localhost:3000`

## API Contract

`POST /api/generate` (multipart form-data), SSE response events:

- `status`
- `complete`
- `error`

Required fields:

- `professorName`
- `university`
- `cvFile`

Optional fields include:

- `contextImage`
- `researchInterests`
- `postingContent`
- `additionalNotes`

## Environment Variables

See `.env.example` for defaults:

- `GEMINI_API_KEY`
- `GEMINI_OPENAI_BASE_URL`
- `AUTOGEN_MODEL`
- `AUTOGEN_SERVICE_URL`
- `WEB_ALLOWED_DOMAINS`
- `WEB_MAX_STEPS`
- `WEB_TIMEOUT_SECONDS`
- `PORT`

## Notes

- The legacy TypeScript agent files remain in `server/agents` for rollback/reference, but are not used at runtime.
- This phase intentionally does not use any SQL/vector/Redis DB.

## License

MIT
