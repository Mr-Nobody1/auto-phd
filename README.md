# PhDApply - AI-Powered PhD Application Assistant

A multi-agent AI system that helps you prepare comprehensive PhD application materials. Powered by Gemini AI.

## Features

- 🔍 **Professor Research** - Automatically researches professor's work, papers, and interests
- 📧 **Personalized Emails** - Generates tailored cold emails with specific paper references  
- 📄 **CV Recommendations** - Detailed suggestions for tailoring your CV
- 💭 **Motivation Letters** - Complete, structured motivation letters
- 📋 **Research Proposals** - Detailed proposals aligned with professor's work
- ⚡ **Real-time Progress** - Watch each agent work in real-time

## Prerequisites

- [Node.js](https://nodejs.org) v18+ (Bun has compatibility issues with Playwright)
- [Gemini API Key](https://makersuite.google.com/app/apikey)

## Setup

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` and add your Gemini API key.

3. **Install Playwright browsers (first time only):**
   ```bash
   npx playwright install chromium
   ```

4. **Start the server:**
   ```bash
   npx tsx --watch server/index.ts

   ```

5. **Open in browser:**
   ```
   http://localhost:3000
   ```

## Usage

1. Enter the professor's name and university
2. Select position language and funding status
3. Upload your CV (PDF format)
4. Add your research interests
5. Click "Generate Application Materials"
6. Watch the agents work in real-time
7. Review and copy your generated materials

## Project Structure

```
phd-apply/
├── server/                 # Backend
│   ├── index.ts           # Hono server
│   ├── orchestrator.ts    # Agent coordination
│   ├── types.ts           # TypeScript types
│   ├── agents/            # AI Agents
│   │   ├── cv-parser.ts
│   │   ├── professor-researcher.ts
│   │   ├── fit-analyzer.ts
│   │   ├── email-writer.ts
│   │   ├── cv-recommender.ts
│   │   ├── motivation-writer.ts
│   │   └── proposal-writer.ts
│   └── tools/             # Utilities
│       ├── gemini.ts
│       ├── browser.ts
│       └── pdf.ts
├── public/                # Frontend
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── package.json
```

## Agents Pipeline

1. **CV Parser** - Extracts structured info from your CV
2. **Professor Researcher** - Scrapes faculty pages + uses Semantic Scholar/OpenAlex APIs
3. **Fit Analyzer** - Analyzes alignment and selects best paper to reference
4. **Email Writer** - Crafts personalized cold email
5. **CV Recommender** - Suggests specific CV changes
6. **Motivation Letter Writer** - Writes full motivation letter
7. **Research Proposal Writer** - Creates detailed research proposal

## Tech Stack

- **Runtime**: Node.js + tsx
- **Backend**: Hono (+ SSE for real-time updates)
- **AI**: Gemini 1.5 (Flash + Pro)
- **Scraping**: Playwright (faculty pages only)
- **Academic Data**: Semantic Scholar & OpenAlex APIs
- **PDF**: pdf2json
- **Frontend**: Vanilla JS + CSS

## License

MIT
