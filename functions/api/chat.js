// ATEN Responde — Cloudflare Pages Function v5 con proxy allorigins
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
  return (texto || 'Sin respuesta.').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function stripHTML(html) {
  return (html || '')
    .replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#8230;/g, '...')
    .replace(/\s{2,}/g, ' ').trim();
}

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 8) {
    const block = match[1];
    const get = (tag) => {
      const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
      return m ? stripHTML(m[1]) : '';
    };
    const title = get('title');
    const pubDate = get('pubDate');
    const description = get('description').slice(0, 200);
    if (title) items.push({ title, pubDate, description });
  }
  return items;
}

async function obtenerNoticiasATEN() {
  const targets = [
    'https://aten.org.ar/wp-json/wp/v2/posts?per_page=8&_fields=title,date,excerpt,link',
    'https://aten.org.ar/feed/',
  ];

  for (const target of targets) {
    try {
      // Intentar directo primero (Cloudflare tiene menos restricciones)
      const rDirecto = await fetch(target, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ATENResponde/1.0)', 'Accept': 'application/json, text/xml, */*' },
        signal: AbortSignal.timeout(6000)
      });
      let content = rDirecto.ok ? await rDirecto.text() : null;

      // Si falla el directo, usar proxy
      if (!content) {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`;
        const rProxy = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
        if (rProxy.ok) {
          const wrapper = await rProxy.json();
          content = wrapper?.contents || null;
        }
      }

      if (!content) continue;

      // Intentar JSON (API WordPress)
      try {
        const posts = JSON.parse(content);
        if (Array.isArray(posts) && posts.length) {
          let ctx = `NOTICIAS RECIENTES DE ATEN NEUQUÉN (fuente: aten.org.ar):\n`;
          for (const post of posts.slice(0, 8)) {
            const titulo = stripHTML(post.title?.rendered || post.title || '');
            const fecha = (post.date || '').slice(0, 10);
            const resumen = stripHTML(post.excerpt?.rendered || '').slice(0, 180);
            if (titulo) {
              ctx += `\n• ${titulo}`;
              if (fecha) ctx += ` (${fecha})`;
              if (resumen) ctx += `\n  ${resumen}`;
            }
          }
          return ctx;
        }
      } catch (_) {}

      // Intentar RSS
      if (content.includes('<item>')) {
        const items = parseRSS(content);
        if (items.length) {
          let ctx = `NOTICIAS RECIENTES DE ATEN NEUQUÉN (fuente: aten.org.ar):\n`;
          for (const item of items) {
            ctx += `\n• ${item.title}`;
            if (item.pubDate) ctx += ` (${item.pubDate.slice(0, 16)})`;
            if (item.description) ctx += `\n  ${item.description}`;
          }
          return ctx;
        }
      }
    } catch { continue; }
  }
  return '';
}

async function callGroq(k, model, messages) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${k}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: 1200, temperature: 0.4 })
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

async function callOR(k, model, messages) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${k}`, 'Content-Type': 'application/json',
      'HTTP-Referer': 'https://aten-responde.pages.dev', 'X-Title': 'ATEN Responde'
    },
    body: JSON.stringify({ model, messages, max_tokens: 1200, temperature: 0.4 })
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

async function getKB(ghToken, ghRepo) {
  if (!ghToken || !ghRepo) return [];
  try {
    const r = await fetch(`https://api.github.com/repos/${ghRepo}/contents/data/kb.json`, {
      headers: { 'Authorization': `Bearer ${ghToken}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!r.ok) return [];
    const data = await r.json();
    const content = atob(data.content.replace(/\n/g, ''));
    return JSON.parse(content);
  } catch { return []; }
}

async function saveKB(ghToken, ghRepo, kb) {
  const r = await fetch(`https://api.github.com/repos/${ghRepo}/contents/data/kb.json`, {
    headers: { 'Authorization': `Bearer ${ghToken}`, 'Accept': 'application/vnd.github.v3+json' }
  });
  if (!r.ok) return false;
  const current = await r.json();
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(kb, null, 2))));
  const upd = await fetch(`https://api.github.com/repos/${ghRepo}/contents/data/kb.json`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${ghToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Update KB ATEN Responde', content, sha: current.sha })
  });
  return upd.ok;
}

function buscarEnKB(kb, pregunta) {
  if (!kb?.length) return null;
  const q = pregunta.toLowerCase();
  const stopwords = new Set(['para','que','con','una','los','las','del','por','como','más','pero','sobre','esta','este','ese','cómo','cuál','qué','cuándo','cuánto']);
  const palabras = q.split(/\s+/).filter(w => w.length > 3 && !stopwords.has(w));
  let mejor = null, maxScore = 0;
  for (const item of kb) {
    if (!item.respuestaVerificada) continue;
    const texto = (item.pregunta + ' ' + (item.temas || []).join(' ')).toLowerCase();
    let score = 0;
    for (const p of palabras) if (texto.includes(p)) score++;
    if (score > maxScore) { maxScore = score; mejor = item; }
  }
  return maxScore >= 2 ? mejor : null;
}

function esConsultaDeNoticias(pregunta) {
  return /noticia|comunicado|paro|huelga|asamblea|acuerdo|salarial|aumento|marcha|moviliz|convocator|reciente|último|hoy|semana|medida.*fuerza|novedad|acontec|pasó|ocurrió|informa|últimas/.test(pregunta.toLowerCase());
}

const cors = {
  'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

export async function onRequestOptions() {
  return new Response('', { status: 200, headers: cors });
}

export async function onRequestPost({ request, env }) {
  const groqKey  = env.GROQ_API_KEY;
  const orKey    = env.OPENROUTER_API_KEY;
  const ghToken  = env.GITHUB_TOKEN;
  const ghRepo   = env.GITHUB_REPO;
  const adminPwd = env.ADMIN_PASSWORD || 'aten2024';

  if (!groqKey && !orKey)
    return new Response(JSON.stringify({ error: 'No hay API key.' }), { status: 500, headers: cors });

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: cors });
  }

  if (body.action === 'saveKB') {
    if (body.password !== adminPwd) return new Response(JSON.stringify({ error: 'Contraseña incorrecta' }), { status: 401, headers: cors });
    const ok = await saveKB(ghToken, ghRepo, body.kb);
    return new Response(JSON.stringify({ ok }), { status: ok ? 200 : 500, headers: cors });
  }

  if (body.action === 'getKB') {
    if (body.password !== adminPwd) return new Response(JSON.stringify({ error: 'Contraseña incorrecta' }), { status: 401, headers: cors });
    const kb = await getKB(ghToken, ghRepo);
    return new Response(JSON.stringify({ kb }), { status: 200, headers: cors });
  }

  const { messages } = body;
  if (!messages?.length) return new Response(JSON.stringify({ error: 'Falta messages' }), { status: 400, headers: cors });

  const preguntaUsuario = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';

  const [kb, noticiasATEN] = await Promise.all([
    getKB(ghToken, ghRepo),
    esConsultaDeNoticias(preguntaUsuario) ? obtenerNoticiasATEN() : Promise.resolve('')
  ]);

  const verificada = buscarEnKB(kb, preguntaUsuario);
  const sysIdx = messages.findIndex(m => m.role === 'system');
  if (sysIdx >= 0) {
    let extra = '';
    if (verificada) extra += `\n\nRESPUESTA VERIFICADA POR ATEN (PRIORIDAD MÁXIMA):\nPregunta: "${verificada.pregunta}"\nRespuesta oficial: "${verificada.respuestaVerificada}"`;
    if (noticiasATEN) extra += `\n\n${noticiasATEN}\n\nUsá estas noticias para responder. Citá aten.org.ar como fuente.`;
    if (extra) messages[sysIdx].content += extra;
  }

  let lastError = null;

  if (groqKey) {
    for (const model of GROQ_MODELS) {
      let r;
      try { r = await callGroq(groqKey, model, messages); } catch(e) { lastError = e.message; continue; }
      if (r.ok) return new Response(JSON.stringify({ reply: limpiarRespuesta(r.data.choices?.[0]?.message?.content) }), { status: 200, headers: cors });
      lastError = r.data.error?.message || `Groq ${r.status}`;
      if (r.status !== 429 && r.status !== 404) break;
    }
  }

  if (orKey) {
    for (const model of OPENROUTER_MODELS) {
      let r;
      try { r = await callOR(orKey, model, messages); } catch(e) { lastError = e.message; continue; }
      if (r.ok) return new Response(JSON.stringify({ reply: limpiarRespuesta(r.data.choices?.[0]?.message?.content) }), { status: 200, headers: cors });
      lastError = r.data.error?.message || `OR ${r.status}`;
      if (r.status !== 429 && r.status !== 404) break;
    }
  }

  return new Response(JSON.stringify({ error: `Todos los motores saturados. (${lastError})` }), { status: 429, headers: cors });
}
