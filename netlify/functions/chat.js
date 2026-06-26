// ATEN Responde — Netlify Function
const GROQ_MODELS = [
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'llama-3.3-70b-versatile',
  'llama3-70b-8192'
];
const OPENROUTER_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'mistralai/mistral-7b-instruct:free',
  'qwen/qwen2.5-72b-instruct:free'
];

function limpiarRespuesta(texto) {
  return (texto || 'Sin respuesta.')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
}

async function callGroq(k, model, messages) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:'POST', headers:{'Authorization':`Bearer ${k}`,'Content-Type':'application/json'},
    body: JSON.stringify({ model, messages, max_tokens:1200, temperature:0.4 })
  });
  return { ok:r.ok, status:r.status, data: await r.json().catch(()=>({})) };
}

async function callOR(k, model, messages) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:'POST', headers:{'Authorization':`Bearer ${k}`,'Content-Type':'application/json','HTTP-Referer':'https://aten-tep-responde.netlify.app','X-Title':'ATEN Responde'},
    body: JSON.stringify({ model, messages, max_tokens:1200, temperature:0.4 })
  });
  return { ok:r.ok, status:r.status, data: await r.json().catch(()=>({})) };
}

exports.handler = async (event) => {
  const cors = {
    'Content-Type':'application/json',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type',
    'Access-Control-Allow-Methods':'POST,OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers:cors, body:'' };
  if (event.httpMethod !== 'POST') return { statusCode:405, body:'Method Not Allowed' };

  const groqKey = process.env.GROQ_API_KEY;
  const orKey   = process.env.OPENROUTER_API_KEY;
  if (!groqKey && !orKey) return { statusCode:500, headers:cors, body: JSON.stringify({ error:'No hay API key configurada.' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode:400, body: JSON.stringify({ error:'JSON inválido' }) }; }
  const { messages } = body;
  if (!messages?.length) return { statusCode:400, body: JSON.stringify({ error:'Falta messages' }) };

  let lastError = null;

  if (groqKey) {
    for (const model of GROQ_MODELS) {
      let r;
      try { r = await callGroq(groqKey, model, messages); } catch(e) { lastError=e.message; continue; }
      if (r.ok) return { statusCode:200, headers:cors, body: JSON.stringify({ reply: limpiarRespuesta(r.data.choices?.[0]?.message?.content) }) };
      lastError = r.data.error?.message || `Groq ${r.status}`;
      if (r.status !== 429 && r.status !== 404) break;
    }
  }

  if (orKey) {
    for (const model of OPENROUTER_MODELS) {
      let r;
      try { r = await callOR(orKey, model, messages); } catch(e) { lastError=e.message; continue; }
      if (r.ok) return { statusCode:200, headers:cors, body: JSON.stringify({ reply: limpiarRespuesta(r.data.choices?.[0]?.message?.content) }) };
      lastError = r.data.error?.message || `OR ${r.status}`;
      if (r.status !== 429 && r.status !== 404) break;
    }
  }

  return { statusCode:429, headers:cors, body: JSON.stringify({ error:`Todos los motores saturados. Probá en unos minutos. (${lastError})` }) };
};
