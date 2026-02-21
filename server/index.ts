import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { readFileSync } from 'fs';

const app = new Hono();
const AUTOGEN_SERVICE_URL = (process.env.AUTOGEN_SERVICE_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');

app.use('/*', cors());

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    autogenServiceUrl: AUTOGEN_SERVICE_URL,
  });
});

function createSseErrorResponse(errorMessage: string, status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const payload = JSON.stringify({ error: errorMessage });
      controller.enqueue(encoder.encode(`event: error\ndata: ${payload}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

function copyFormData(original: FormData): FormData {
  const forwarded = new FormData();

  for (const [key, value] of original.entries()) {
    if (typeof value === 'string') {
      forwarded.append(key, value);
      continue;
    }

    if (value instanceof File && value.size > 0) {
      forwarded.append(key, value, value.name);
    }
  }

  return forwarded;
}

app.post('/api/generate', async (c) => {
  try {
    const formData = await c.req.formData();

    const professorName = String(formData.get('professorName') || '').trim();
    const university = String(formData.get('university') || '').trim();
    const cvFile = formData.get('cvFile');

    if (!professorName || !university) {
      return c.json({ error: 'Professor name and university are required' }, 400);
    }

    if (!(cvFile instanceof File) || cvFile.size === 0) {
      return c.json({ error: 'CV file is required' }, 400);
    }

    const upstreamFormData = copyFormData(formData);

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(`${AUTOGEN_SERVICE_URL}/generate`, {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
        },
        body: upstreamFormData,
      });
    } catch (error) {
      console.error('Failed to connect to AutoGen service:', error);
      return createSseErrorResponse(
        `AutoGen service is unavailable at ${AUTOGEN_SERVICE_URL}. Start the Python service and try again.`
      );
    }

    if (!upstreamResponse.ok) {
      const errorBody = await upstreamResponse.text().catch(() => '');
      const preview = errorBody ? ` ${errorBody.slice(0, 300)}` : '';
      return createSseErrorResponse(`AutoGen service returned ${upstreamResponse.status}.${preview}`);
    }

    if (!upstreamResponse.body) {
      return createSseErrorResponse('AutoGen service returned an empty stream.');
    }

    return new Response(upstreamResponse.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('API proxy error:', error);
    return createSseErrorResponse(String(error));
  }
});

app.get('/', async (c) => {
  const html = readFileSync('./public/index.html', 'utf-8');
  return c.html(html);
});

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

const port = Number(process.env.PORT) || 3000;

const { serve } = await import('@hono/node-server');
console.log(`PhDApply server running at http://localhost:${port}`);
serve({
  fetch: app.fetch,
  port,
});
