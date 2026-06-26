// ATEN Responde — Cloudflare Pages Function
// Responde en /api/chat usando Groq + OpenRouter como fallback

const GROQ_MODELS = [
  'meta-llama/llama-4-maverick:free',
  'qwen/qwen3.6-27b',
  'openai/gpt-oss-20b'
];

const OPENROUTER_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-chat:free',
  'qwen/qwen2.5-72b-instruct:free',
  'mistralai/mistral-7b-instruct:free'
];

async function callGroq(apiKey, model, messages) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: 1200, temperature: 0.4 })
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function callOpenRouter(apiKey, model, messages) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://aten-responde.pages.dev',
      'X-Title': 'ATEN Responde'
    },
    body: JSON.stringify({ model, messages, max_tokens: 1200, temperature: 0.4 })
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const groqKey = env.GROQ_API_KEY;
  const orKey   = env.OPENROUTER_API_KEY;

  if (!groqKey && !orKey) {
    return new Response(
      JSON.stringify({ error: 'No hay API key configurada. El administrador debe agregar GROQ_API_KEY en las variables de entorno.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 });
  }

  const { messages } = body;
  if (!messages?.length) {
    return new Response(JSON.stringify({ error: 'Falta el campo messages' }), { status: 400 });
  }

  let lastError = null;
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  // 1) Groq primero (más cuota gratis)
  if (groqKey) {
    for (const model of GROQ_MODELS) {
      let result;
      try { result = await callGroq(groqKey, model, messages); } catch(e) { lastError = e.message; continue; }
      if (result.ok) {
        const reply = result.data.choices?.[0]?.message?.content || 'Sin respuesta.';
        return new Response(JSON.stringify({ reply }), { headers: cors });
      }
      lastError = result.data.error?.message || `Groq ${result.status}`;
      if (result.status !== 429 && result.status !== 404) break;
    }
  }

  // 2) OpenRouter como respaldo
  if (orKey) {
    for (const model of OPENROUTER_MODELS) {
      let result;
      try { result = await callOpenRouter(orKey, model, messages); } catch(e) { lastError = e.message; continue; }
      if (result.ok) {
        const reply = result.data.choices?.[0]?.message?.content || 'Sin respuesta.';
        return new Response(JSON.stringify({ reply }), { headers: cors });
      }
      lastError = result.data.error?.message || `OR ${result.status}`;
      if (result.status !== 429 && result.status !== 404) break;
    }
  }

  return new Response(
    JSON.stringify({ error: `Todos los motores están saturados. Probá en unos minutos. (${lastError})` }),
    { status: 429, headers: cors }
  );
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
