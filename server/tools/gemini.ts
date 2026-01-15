import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Use Gemini 1.5 Flash for speed, Pro for quality-critical tasks
const flashModel = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
const proModel = genAI.getGenerativeModel({ model: 'gemini-3-pro-preview' });

export interface GeminiOptions {
  useProModel?: boolean;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Call Gemini API with a prompt
 */
export async function callGemini(
  prompt: string,
  options: GeminiOptions = {}
): Promise<string> {
  const { useProModel = false, temperature = 0.7, maxTokens = 8192 } = options;

  const model = useProModel ? proModel : flashModel;

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    });

    const response = result.response;
    return response.text();
  } catch (error) {
    console.error('Gemini API error:', error);
    throw new Error(`Gemini API call failed: ${error}`);
  }
}

/**
 * Call Gemini and parse JSON response
 */
export async function callGeminiJSON<T>(
  prompt: string,
  options: GeminiOptions = {}
): Promise<T> {
  const jsonPrompt = `${prompt}

IMPORTANT: Respond ONLY with valid JSON. No markdown, no code blocks, no explanation.`;

  const response = await callGemini(jsonPrompt, options);

  // Try to extract JSON from the response
  let jsonStr = response.trim();

  // Remove markdown code blocks if present
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3);
  }

  jsonStr = jsonStr.trim();

  try {
    return JSON.parse(jsonStr) as T;
  } catch (error) {
    console.error('Failed to parse Gemini JSON response:', jsonStr);
    throw new Error(`Failed to parse JSON response: ${error}`);
  }
}

/**
 * Check if Gemini API key is configured
 */
export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}
