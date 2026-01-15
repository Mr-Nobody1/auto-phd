import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { runPipeline, type StatusCallback } from './orchestrator';
import { parsePDFBuffer } from './tools/pdf';
import { closeBrowser } from './tools/browser';
import type { UserInput, AgentStatus } from './types';
import { readFileSync } from 'fs';

const app = new Hono();

// Enable CORS
app.use('/*', cors());

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main generation endpoint with SSE
app.post('/api/generate', async (c) => {
  try {
    const formData = await c.req.formData();

    // Extract form fields
    const professorName = formData.get('professorName') as string;
    const university = formData.get('university') as string;
    const language = (formData.get('language') as string) || 'english';
    const customLanguage = formData.get('customLanguage') as string;
    const fundingStatus = (formData.get('fundingStatus') as string) || 'fully_funded';
    const researchInterests = formData.get('researchInterests') as string;
    const preferredStart = formData.get('preferredStart') as string;
    const cvFile = formData.get('cvFile') as File;

    // Validate required fields
    if (!professorName || !university) {
      return c.json({ error: 'Professor name and university are required' }, 400);
    }

    if (!cvFile) {
      return c.json({ error: 'CV file is required' }, 400);
    }

    // Parse CV
    const cvBuffer = Buffer.from(await cvFile.arrayBuffer());
    const cvText = await parsePDFBuffer(cvBuffer);

    const input: UserInput = {
      professorName,
      university,
      language: language as UserInput['language'],
      customLanguage: customLanguage || undefined,
      fundingStatus: fundingStatus as UserInput['fundingStatus'],
      researchInterests: researchInterests || '',
      preferredStart: preferredStart || 'Fall 2026',
      cvText,
    };

    // Create SSE response with controller state tracking
    let isClosed = false;
    
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const sendEvent = (event: string, data: unknown) => {
          if (isClosed) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch (error) {
            console.error('Failed to send event:', error);
            isClosed = true;
          }
        };

        const onStatus: StatusCallback = (status: AgentStatus) => {
          sendEvent('status', status);
        };

        try {
          // Run the pipeline
          const result = await runPipeline(input, cvText, onStatus);

          // Send final result
          sendEvent('complete', result);
        } catch (error) {
          sendEvent('error', { error: String(error) });
        } finally {
          if (!isClosed) {
            isClosed = true;
            controller.close();
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('API error:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Serve the frontend
app.get('/', async (c) => {
  const html = readFileSync('./public/index.html', 'utf-8');
  return c.html(html);
});

// Serve static files
app.get('/public/*', async (c) => {
  const path = '.' + c.req.path;
  try {
    const content = readFileSync(path, 'utf-8');
    const ext = path.split('.').pop();
    const contentType = ext === 'css' ? 'text/css' : ext === 'js' ? 'application/javascript' : 'text/plain';
    return new Response(content, { headers: { 'Content-Type': contentType } });
  } catch {
    return c.notFound();
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await closeBrowser();
  process.exit(0);
});

const port = Number(process.env.PORT) || 3000;

// Support both Bun and Node.js
const isBun = typeof globalThis.Bun !== 'undefined';

if (!isBun) {
  // Running in Node.js - start server immediately
  const { serve } = await import('@hono/node-server');
  console.log(`🚀 PhDApply server running at http://localhost:${port} (Node.js)`);
  serve({
    fetch: app.fetch,
    port,
  });
} else {
  console.log(`🚀 PhDApply server running at http://localhost:${port} (Bun)`);
}

// Export for Bun
export default {
  port,
  fetch: app.fetch,
  idleTimeout: 255,
};
