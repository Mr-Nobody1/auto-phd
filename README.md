# PhDApply

PhDApply is an autonomous PhD application generator that uses a cooperative pipeline of 8 AI agents (powered by Microsoft AutoGen) to help you research, write, and tailor outreach emails and research proposals for prospective advisors.

## Quick Start

### Prerequisites
- Node.js 18+ (or Bun)
- Python 3.11+
- A valid `GEMINI_API_KEY`

### 1. Install Dependencies
Install the Node (frontend) and Python (backend) dependencies:

```bash
bun install  # or npm install
pip install -e ./autogen_service
```

### 2. Configure Environment
Copy the example environment file and add your API keys:

```bash
cp .env.example .env
```
*Ensure you set `GEMINI_API_KEY`, `AUTOGEN_MODEL`, and `AUTOGEN_SERVICE_URL` inside `.env`.*

### 3. Run the Development Server
Start both the frontend and backend services simultaneously:

```bash
bun run dev  # or npm run dev
```

The web UI will be available at [`http://localhost:3000`](http://localhost:3000), and the backend runs on `http://localhost:8001`.

## 🚀 How to Use PhDApply

Using PhDApply is designed to be straightforward. The UI will guide you through entering your information, and you'll be able to track the AI agents' progress in real-time.

1. **Required Information:** Enter the target **Professor's Name**, their **University**, and upload your **CV (PDF)**.
2. **Optional Context:** To get the best results, you can provide additional details:
   - **Language:** English, German, French, or Custom.
   - **Funding Status:** Fully Funded, Partially Funded, Self Funded, etc.
   - **Research Interests & Notes:** Give the AI hints on what specific angles you want to emphasize.
   - **Posting Content:** Paste the raw text of a PhD opportunity or job posting if you have one.
   - **Context Image:** You can upload an image (e.g., a screenshot of a lab website or a specific paper graph) to give the AI more context.
3. **Generation:** Click generate. The UI will stream real-time events, showing you exactly which of the 8 agents is currently working and what it's doing.
4. **Results:** Once complete, the system outputs:
   - A personalized outreach email.
   - Specific CV tailoring recommendations to match the professor.
   - A motivation letter draft.
   - A targeted research proposal.

## 🏗️ Architecture Overview

The system is split into two loosely coupled runtime services that communicate over Server-Sent Events (SSE):

1. **Frontend UI Gateway (`server/index.ts`)**: A Node.js backend using the Hono framework. It serves the static React frontend from `public/` and proxies all `/api/generate` multipart/form-data requests straight to the Python backend. It transparently handles passing tracking events via SSE back to the user interface.
2. **Backend Orchestrator (`autogen_service/app/main.py`)**: A Python FastAPI service that executes the conversational pipeline. All agent interactions, context gathering, and LLM calls happen here in memory per request. **There is intentionally no database.**

## 🧠 The 8-Step AutoGen Pipeline

All core logic resides within `autogen_service/app/pipeline.py`. When a user submits an application request, a linear but autonomous 8-step pipeline starts:

1. **CV Parser:** Extracts structured data (name, education, experience, publications) out of the raw applicant PDF.
2. **Professor Researcher:** The `context_researcher` agent uses the OpenAlex tool and web scrapers to gather seed context, returning a comprehensive academic profile of the targeted professor.
3. **Paper Selector:** Evaluates the professor's recent works and selects up to 3 of the most relevant papers tailored to the applicant's research interests.
4. **Fit Analyzer:** Synthesizes the applicant profile against the professor's profile to isolate common intersections, creating an aligned "suggested angle."
5. **Email Writer:** Using the synthesized fit analysis, writes a targeted outreach email designed to secure a conversation.
6. **CV Recommender:** Suggests actionable improvements and modifications for the applicant's CV to make it strictly fit the professor's lab.
7. **Motivation Letter Writer:** Generates a structured motivation letter aligning the applicant's personal background with the lab's mission.
8. **Research Proposal Writer:** Drafts a preliminary research proposal anchored in the selected intersecting papers.

## 📁 Code Reference & Tooling

If you're exploring the repository, here's where to find the important pieces:
- `autogen_service/app/main.py`: The FastAPI server entry point.
- `autogen_service/app/pipeline.py`: The definition of all 8 agents and the `run_pipeline_stream` loop.
- `autogen_service/app/schemas.py`: Pydantic data schemas for SSE payloads and user input.
- `autogen_service/app/tools/academic_api.py`: Integrates with the **OpenAlex API** to reliably search over scholarly works without needing a key.
- `autogen_service/app/tools/web_context.py`: Fallback DuckDuckGo HTML scraping logic that pulls university emails and missing research interest links for professors with small footprints.
- `autogen_service/app/tools/image_context.py`: Simple utility to prompt the Gemini Vision API using an uploaded user image.

## ⚙️ Environment Configuration

Refer to `.env.example`. Make sure you've mapped your setup properly:

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMINI_API_KEY` | **Required.** Core AI model access key. | *None* |
| `GEMINI_OPENAI_BASE_URL`| Maps to `https://generativelanguage.googleapis.com/v1beta/openai/` | *None* |
| `AUTOGEN_MODEL` | The designated Gemini-compatible model string (e.g., `gemini-3-flash-preview`)` |
| `AUTOGEN_SERVICE_URL` | Used by the Node gateway proxy to locate Python | `http://127.0.0.1:8001` |
| `WEB_ALLOWED_DOMAINS` | Search scopes (e.g. `edu,ac.uk`) for scraping | `edu,ac.uk,ac.jp,ac.in` |
| `WEB_MAX_STEPS` | Max URLs to scrape per run | `6` |
| `WEB_TIMEOUT_SECONDS` | Scraping agent timeout guardrail | `90` |
| `PORT` | Node UI gateway port | `3000` |
