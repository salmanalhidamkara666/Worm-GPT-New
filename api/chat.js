// Serverless function for Vercel with Gemini and OpenRouter streaming fallback.

import { PERSONA } from '../js/config.js';

const getApiKeys = (...names) => {
  const value = names.map(name => process.env[name]).find(Boolean) || '';
  return value.split(',').map(key => key.trim()).filter(Boolean);
};

const toOpenRouterMessages = contents => contents.map(message => ({
  role: message.role === 'model' ? 'assistant' : message.role,
  content: (message.parts || []).map(part => part.text || '').join('\n')
}));

const getMessageText = message => (message?.parts || [])
  .map(part => part.text || '')
  .join('\n')
  .trim();

const getSearchQuery = contents => {
  const lastUserMessage = [...contents].reverse()
    .find(message => message.role === 'user');
  const text = getMessageText(lastUserMessage);
  return text.toLowerCase().startsWith('/search ')
    ? text.slice(8).trim()
    : '';
};

const searchWeb = async query => {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed with status ${response.status}`);
  }

  const data = await response.json();
  const relatedTopics = (data.RelatedTopics || [])
    .filter(topic => topic.Text && topic.FirstURL)
    .slice(0, 6)
    .map(topic => `- ${topic.Text}\n  Source: ${topic.FirstURL}`)
    .join('\n');
  const abstract = data.AbstractText
    ? `- ${data.AbstractText}\n  Source: ${data.AbstractURL || 'DuckDuckGo'}`
    : '';
  const results = [abstract, relatedTopics].filter(Boolean).join('\n');

  if (!results) {
    throw new Error('DuckDuckGo returned no usable results');
  }

  return `Web search results for "${query}":\n${results}`;
};

const addSearchContext = (contents, searchContext) => searchContext
  ? [
      ...contents,
      {
        role: 'user',
        parts: [{
          text: `${searchContext}\n\nUse these sources to answer the search request. Include source links and clearly distinguish facts from uncertainty.`
        }]
      }
    ]
  : contents;

const sendEvent = (res, payload) => {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const extractText = (provider, data) => provider === 'gemini'
  ? data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('\n') || ''
  : data?.choices?.[0]?.delta?.content || '';

const getProviderRequest = (provider, key, model, contents, messages) => {
  if (provider === 'gemini') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key
      },
      body: {
        systemInstruction: { parts: [{ text: PERSONA }] },
        contents
      }
    };
  }

  return {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.SITE_URL || 'https://example.com',
      'X-Title': 'Worm AI'
    },
    body: {
      model,
      stream: true,
      messages: [{ role: 'system', content: PERSONA }, ...messages]
    }
  };
};

const streamProvider = async (res, provider, key, model, contents, messages) => {
  const request = getProviderRequest(provider, key, model, contents, messages);
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body)
  });

  if (!response.ok || !response.body) {
    const errorData = await response.json().catch(() => null);
    return {
      ok: false,
      error: {
        status: response.status || 500,
        message: errorData?.error?.message || `${provider} request failed`,
        details: errorData
      }
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;

      try {
        const text = extractText(provider, JSON.parse(raw));
        if (text) sendEvent(res, { text });
      } catch (error) {
        console.warn(`[${provider}] Invalid streaming event`, error);
      }
    }

    if (done) break;
  }

  if (buffer.startsWith('data: ')) {
    try {
      const text = extractText(provider, JSON.parse(buffer.slice(6).trim()));
      if (text) sendEvent(res, { text });
    } catch (error) {
      console.warn(`[${provider}] Invalid final streaming event`, error);
    }
  }

  sendEvent(res, { done: true });
  res.end();
  return { ok: true };
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { contents } = req.body;
  if (!contents || !Array.isArray(contents)) {
    return res.status(400).json({ error: 'Body "contents" must be an array' });
  }

  const geminiKeys = getApiKeys('GEMINI_API_KEYS', 'GEMINI_API_KEY');
  const openRouterKeys = getApiKeys('OPENROUTER_API_KEYS', 'OPENROUTER_API_KEY');
  const geminiModel = process.env.GEMINI_MODEL || 'gemma-3-27b-it';
  const openRouterModel = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3.5-lightning:free';
  const searchQuery = getSearchQuery(contents);
  let searchContext = '';

  if (searchQuery) {
    try {
      searchContext = await searchWeb(searchQuery);
    } catch (error) {
      console.warn('[Search] DuckDuckGo search failed:', error.message);
      return res.status(502).json({
        error: 'Search failed',
        message: 'Pencarian web gratis gagal. Coba lagi dengan kata kunci lain.'
      });
    }
  }

  const enrichedContents = addSearchContext(contents, searchContext);
  const messages = toOpenRouterMessages(enrichedContents);
  let lastError = null;

  for (let i = 0; i < geminiKeys.length; i++) {
    try {
      const result = await streamProvider(
        res, 'gemini', geminiKeys[i], geminiModel, enrichedContents, messages
      );
      if (result.ok) return;
      lastError = result.error;
    } catch (error) {
      lastError = { status: 500, message: error.message || 'Gemini network error' };
    }
    console.warn(`[Gemini] Key ${i + 1}/${geminiKeys.length} failed. Trying next key...`);
  }

  for (let i = 0; i < openRouterKeys.length; i++) {
    try {
      const result = await streamProvider(
        res, 'openrouter', openRouterKeys[i], openRouterModel, enrichedContents, messages
      );
      if (result.ok) return;
      lastError = result.error;
    } catch (error) {
      lastError = { status: 500, message: error.message || 'OpenRouter network error' };
    }
    console.warn(`[OpenRouter] Key ${i + 1}/${openRouterKeys.length} failed. Trying next key...`);
  }

  return res.status(lastError?.status || 500).json({
    error: 'Generation failed',
    message: lastError?.message || 'Semua API key gagal atau belum dikonfigurasi.',
    details: lastError?.details
  });
}
