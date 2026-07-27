// utils/groq.js
// Thin wrapper around the Groq chat completions API (OpenAI-compatible schema).
// Docs: https://console.groq.com/docs/api-reference

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const VISION_MODEL = process.env.GROQ_VISION_MODEL || 'llama-3.2-11b-vision-preview';

async function callGroq(messages, options = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GROQ_API_KEY is not set. Copy .env.example to .env and add your key from https://console.groq.com/keys'
    );
  }

  const body = {
    model: options.model || DEFAULT_MODEL,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 900,
  };

  if (options.json) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Groq API error ${response.status}: ${errText || response.statusText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Groq API returned no content.');
  }
  return content;
}

async function callGroqJSON(messages, options = {}) {
  const raw = await callGroq(messages, { ...options, json: true });
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse Groq JSON response: ${err.message}\nRaw: ${cleaned.slice(0, 400)}`);
  }
}

// Vision call: images is an array of base64 data URLs (data:image/jpeg;base64,...)
async function callGroqVision(promptText, images, options = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set.');
  }
  const content = [
    { type: 'text', text: promptText },
    ...images.slice(0, 4).map((img) => ({ type: 'image_url', image_url: { url: img } })),
  ];

  const body = {
    model: options.model || VISION_MODEL,
    messages: [{ role: 'user', content }],
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 400,
  };

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Groq vision API error ${response.status}: ${errText || response.statusText}`);
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq vision API returned no content.');
  return text;
}

module.exports = { callGroq, callGroqJSON, callGroqVision, DEFAULT_MODEL, VISION_MODEL };
