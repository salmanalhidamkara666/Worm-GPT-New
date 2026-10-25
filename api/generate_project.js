import { PERSONA } from '../js/config.js';

const getKeys = (...names) => {
  const value = names.map(name => process.env[name]).find(Boolean) || '';
  return [...new Set(value.split(',').map(key => key.trim()).filter(Boolean))];
};

const PROVIDER_TIMEOUT_MS = 15000;

const projectPrompt = request => `Create a small static website project for this request:
${request}

Return ONLY valid JSON in this exact shape:
{"summary":"short summary","files":[{"path":"index.html","content":"..."},{"path":"style.css","content":"..."},{"path":"script.js","content":"..."}]}

Requirements:
- Include exactly index.html, style.css, and script.js.
- Keep all code self-contained and safe to run in a browser.
- index.html must reference ./style.css and ./script.js.
- Do not use markdown fences or extra text outside JSON.`;

const fetchWithTimeout = async (url, options, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const parseProject = text => {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const project = JSON.parse(cleaned);
  if (!project || !Array.isArray(project.files) || project.files.length === 0) {
    throw new Error('Model returned an invalid project');
  }

  const files = project.files
    .filter(file => typeof file?.path === 'string' && typeof file?.content === 'string')
    .map(file => ({ path: file.path.replace(/^\/+/, ''), content: file.content }))
    .filter(file => ['index.html', 'style.css', 'script.js'].includes(file.path));

  if (!files.some(file => file.path === 'index.html')) {
    throw new Error('Generated project is missing index.html');
  }

  return { summary: project.summary || 'Generated static website', files };
};

const requestGemini = async (key, model, prompt, timeoutMs) => {
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PERSONA }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      })
    },
    timeoutMs
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || 'Gemini request failed');
  return data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('\n') || '';
};

const requestOpenRouter = async (key, model, prompt, timeoutMs) => {
  const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.SITE_URL || 'https://example.com',
      'X-Title': 'Worm AI Web Builder'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: PERSONA },
        { role: 'user', content: prompt }
      ]
    })
  }, timeoutMs);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || 'OpenRouter request failed');
  return data?.choices?.[0]?.message?.content || '';
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const request = typeof req.body?.request === 'string' ? req.body.request.trim() : '';
  if (!request) return res.status(400).json({ error: 'Body "request" is required' });
  if (request.length > 4000) return res.status(413).json({ error: 'Request is too long' });

  const geminiKeys = getKeys('GEMINI_API_KEYS', 'GEMINI_API_KEY');
  const openRouterKeys = getKeys('OPENROUTER_API_KEYS', 'OPENROUTER_API_KEY');
  const prompt = projectPrompt(request);
  let lastError = null;
  const providerDeadline = Date.now() + PROVIDER_TIMEOUT_MS;

  for (const key of geminiKeys) {
    const timeoutMs = Math.max(1, providerDeadline - Date.now());
    try {
      return res.status(200).json(parseProject(await requestGemini(
        key, process.env.GEMINI_MODEL || 'gemini-flash-lite-latest', prompt, timeoutMs
      )));
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= providerDeadline) break;
  }

  const openRouterDeadline = Date.now() + PROVIDER_TIMEOUT_MS;
  for (const key of openRouterKeys) {
    const timeoutMs = Math.max(1, openRouterDeadline - Date.now());
    try {
      return res.status(200).json(parseProject(await requestOpenRouter(
        key, process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free', prompt, timeoutMs
      )));
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= openRouterDeadline) break;
  }

  return res.status(503).json({
    error: 'No provider available',
    message: lastError?.message || 'No active API key found'
  });
}
