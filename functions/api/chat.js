// ATEN Responde — Cloudflare Pages Function v6
// Con búsqueda en aten.org.ar + LM Neuquén + Río Negro
// Recuadro de autoridades + KB verificada

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

// ── Comisión Directiva Provincial ATEN ──
const AUTORIDADES_ATEN = {
  titulo: 'Comisión Directiva Provincial ATEN — Gestión actual',
  miembros: [
    { cargo: 'Secretaria General',      nombre: 'Fanny Mansilla' },
    { cargo: 'Secretaria Adjunta',      nombre: 'Cintia Galetto' },
    { cargo: 'Secretaría Gremial',      nombre: 'Ángel Zalazar' },
    { cargo: 'Secretaría de Prensa',    nombre: 'Marisabel Granda' },
    { cargo: 'Secretaría de Finanzas',  nombre: 'Alberto Pérez' },
    { cargo: 'Secretaría de Formación', nombre: 'Cristian Lermanda' },
    { cargo: 'Secretaría de Primaria',  nombre: 'María Sudan' },
    { cargo: 'Secretaría de Especial',  nombre: 'Nina Arévalo' },
    { cargo: 'Secretaría de Inicial',   nombre: 'Carolina Knotek' },
  ]
};

// Contexto de autoridades para el system prompt
function buildAutoridadesCtx() {
  const lista = AUTORIDADES_ATEN.miembros
    .map(m => `- ${m.cargo}: ${m.nombre}`)
    .join('\n');
  return `COMISIÓN DIRECTIVA PROVINCIAL ATEN (datos oficiales verificados):\n${lista}`;
}

function limpiarRespuesta(texto) {
  return (texto || 'Sin respuesta.').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function stripHTML(html) {
  return (html || '')
    .replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
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
  while ((match = itemRegex.exec(xml)) !== null && items.length < 6) {
    const block = match[1];
    const get = (tag) => {
      const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
      return m ? stripHTML(m[1]) : '';
    };
    const title = get('title');
    const pubDate = get('pubDate');
    const description = get('description').slice(0, 150);
    if (title) items.push({ title, pubDate, description });
  }
  return items;
}

// Determinar qué tipo de consulta es
function clasificarConsulta(pregunta) {
  const q = pregunta.toLowerCase();
  const esAutoridades = /secretari|conductor|conduccion|comision|directiva|cargo|autoridad|quien es|quién es|dirige|dirigen|conduce|conducen|mansilla|galetto|zalazar|granda|perez|lermanda|sudan|arevalo|knotek/.test(q);
  const esNoticias = /noticia|comunicado|paro|huelga|asamblea|acuerdo|salarial|aumento|marcha|moviliz|convocator|reciente|último|hoy|semana|medida.*fuerza|novedad|acontec|pasó|ocurrió|informa|últimas/.test(q);
  const esLocal = /diario|neuquén|provincia|local|región|patagonia|rionegro|lmneuquen/.test(q);
  return { esAutoridades, esNoticias, esLocal };
}

// Buscar en una URL via proxy allorigins o directo
async function fetchContenido(url) {
  // Intento directo primero
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ATENResponde/1.0)', 'Accept': 'application/json, application/rss+xml, text/xml, text/html, */*' },
      signal: AbortSignal.timeout(5000)
    });
    if (r.ok) return await r.text();
  } catch (_) {}

  // Fallback: proxy allorigins
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(7000) });
    if (r.ok) {
      const wrapper = await r.json();
      return wrapper?.contents || null;
    }
  } catch (_) {}

  return null;
}

// Buscar noticias en aten.org.ar
async function buscarATEN() {
  const targets = [
    'https://aten.org.ar/wp-json/wp/v2/posts?per_page=6&_fields=title,date,excerpt,link',
    'https://aten.org.ar/feed/',
  ];
  for (const url of targets) {
    const content = await fetchContenido(url);
    if (!content) continue;
    try {
      const posts = JSON.parse(content);
      if (Array.isArray(posts) && posts.length) {
        return 'NOTICIAS RECIENTES DE ATEN (aten.org.ar):\n' + posts.slice(0, 6).map(p => {
          const t = stripHTML(p.title?.rendered || p.title || '');
          const f = (p.date || '').slice(0, 10);
          const r = stripHTML(p.excerpt?.rendered || '').slice(0, 120);
          return `• ${t}${f ? ` (${f})` : ''}${r ? `\n  ${r}` : ''}`;
        }).join('\n');
      }
    } catch (_) {}
    if (content.includes('<item>')) {
      const items = parseRSS(content);
      if (items.length) {
        return 'NOTICIAS RECIENTES DE ATEN (aten.org.ar):\n' + items.map(i =>
          `• ${i.title}${i.pubDate ? ` (${i.pubDate.slice(0,16)})` : ''}${i.description ? `\n  ${i.description}` : ''}`
        ).join('\n');
      }
    }
  }
  return '';
}

// Buscar en LM Neuquén
async function buscarLMNeuquen(query) {
  const url = `https://www.lmneuquen.com/?s=${encodeURIComponent(query)}`;
  const content = await fetchContenido(url);
  if (!content) return '';
  const texto = stripHTML(content).slice(0, 1500);
  if (texto.length < 100) return '';
  return `RESULTADOS EN LM NEUQUÉN (lmneuquen.com) para "${query}":\n${texto.slice(0, 800)}`;
}

// Buscar en Río Negro
async function buscarRioNegro(query) {
  const url = `https://www.rionegro.com.ar/?s=${encodeURIComponent(query)}`;
  const content = await fetchContenido(url);
  if (!content) return '';
  const texto = stripHTML(content).slice(0, 1500);
  if (texto.length < 100) return '';
  return `RESULTADOS EN DIARIO RÍO NEGRO (rionegro.com.ar) para "${query}":\n${texto.slice(0, 800)}`;
}

async function callGroq(k, model, messages) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${k}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: 1400, temperature: 0.4 })
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

async function callOR(k, model, messages) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${k}`, 'Content-Type': 'application/json',
      'HTTP-Referer': 'https://chatgptep.pages.dev', 'X-Title': 'ATEN Responde'
    },
    body: JSON.stringify({ model, messages, max_tokens: 1400, temperature: 0.4 })
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
    return JSON.parse(atob(data.content.replace(/\n/g, '')));
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

  // Devolver también autoridades en getKB para que el panel las muestre
  if (body.action === 'getKB') {
    if (body.password !== adminPwd) return new Response(JSON.stringify({ error: 'Contraseña incorrecta' }), { status: 401, headers: cors });
    const kb = await getKB(ghToken, ghRepo);
    return new Response(JSON.stringify({ kb, autoridades: AUTORIDADES_ATEN }), { status: 200, headers: cors });
  }

  const { messages } = body;
  if (!messages?.length) return new Response(JSON.stringify({ error: 'Falta messages' }), { status: 400, headers: cors });

  const preguntaUsuario = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
  const { esAutoridades, esNoticias } = clasificarConsulta(preguntaUsuario);

  // Buscar en paralelo según el tipo de consulta
  const [kb, noticiasATEN, noticiasLMN, noticiasRN] = await Promise.all([
    getKB(ghToken, ghRepo),
    esNoticias ? buscarATEN() : Promise.resolve(''),
    (esNoticias || esAutoridades) ? buscarLMNeuquen(preguntaUsuario) : Promise.resolve(''),
    (esNoticias || esAutoridades) ? buscarRioNegro(preguntaUsuario) : Promise.resolve(''),
  ]);

  const verificada = buscarEnKB(kb, preguntaUsuario);
  const sysIdx = messages.findIndex(m => m.role === 'system');

  if (sysIdx >= 0) {
    let extra = '';

    // Siempre inyectar autoridades en el sistema
    extra += `\n\n${buildAutoridadesCtx()}`;

    if (verificada)
      extra += `\n\nRESPUESTA VERIFICADA POR ATEN (PRIORIDAD MÁXIMA):\nPregunta: "${verificada.pregunta}"\nRespuesta oficial: "${verificada.respuestaVerificada}"`;

    if (noticiasATEN)
      extra += `\n\n${noticiasATEN}`;

    if (noticiasLMN)
      extra += `\n\n${noticiasLMN}`;

    if (noticiasRN)
      extra += `\n\n${noticiasRN}`;

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
