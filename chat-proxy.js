/* ╔══════════════════════════════════════════════════════════════════════╗
   ║                           CHAT PROXY                                   ║
   ║        Прокси для музыки и ИИ — чтобы всё работало без VPN             ║
   ╚══════════════════════════════════════════════════════════════════════╝

   Что проксирует:
     /audius/…   → каталог и потоки Audius (треки, поиск, тренды, аудио с перемоткой)
     /radio/…    → каталог радиостанций Radio Browser (раздел «Мир»)
     /ai/…       → ваш Worker расшифровки и перевода (Cloudflare), если задан AI_UPSTREAM
     /health     → проверка: что сервер видит (открывается в браузере)

   Требования: Node.js 18+ (есть в Ubuntu 24.04 из коробки). Внешних пакетов не нужно.

   Настройки (переменные окружения):
     PORT            порт, по умолчанию 8787
     ALLOWED_ORIGIN  адрес вашего сайта, например https://99999cent-bit.github.io (можно несколько через запятую)
     AI_UPSTREAM     адрес вашего Worker'а ИИ, например https://old-tree-4f4b.99999cent.workers.dev
     RATE_PER_MIN    запросов в минуту с одного IP, по умолчанию 240
   ══════════════════════════════════════════════════════════════════════ */
'use strict';
const http = require('http');
const { Readable } = require('stream');

const PORT = +process.env.PORT || 8787;
const ALLOWED = String(process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
const AI_UPSTREAM = String(process.env.AI_UPSTREAM || '').replace(/\/+$/, '');
const AUDIUS_API = String(process.env.AUDIUS_API || 'https://api.audius.co/v1').replace(/\/+$/, '');
const RADIO_BASES = String(process.env.RADIO_BASES || 'https://de1.api.radio-browser.info,https://de2.api.radio-browser.info,https://fi1.api.radio-browser.info')
  .split(',').map(s => s.trim()).filter(Boolean);
const RATE_PER_MIN = +process.env.RATE_PER_MIN || 240;
const UA = 'ChatProxy/1.0';

/* ---------- CORS ---------- */
function corsHeaders(req) {
  const origin = req.headers.origin || '';
  const allow = !ALLOWED.length ? '*' : (ALLOWED.includes(origin) ? origin : ALLOWED[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
function originAllowed(req) {
  if (!ALLOWED.length) return true;
  const o = req.headers.origin;
  if (!o) return true;                 // прямые запросы плеера (аудио) и открытие /health в браузере
  return ALLOWED.includes(o);
}

/* ---------- ограничение частоты ---------- */
const hits = new Map();
function rateOk(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (list.length >= RATE_PER_MIN) { hits.set(ip, list); return false; }
  list.push(now); hits.set(ip, list);
  if (hits.size > 20000) hits.clear();
  return true;
}

/* ---------- кэш для списков (тренды/поиск/станции) ---------- */
const cache = new Map();
const CACHE_MS = 5 * 60 * 1000;
function cacheGet(k) { const c = cache.get(k); if (c && Date.now() - c.at < CACHE_MS) return c; cache.delete(k); return null; }
function cachePut(k, v) { cache.set(k, v); if (cache.size > 500) cache.delete(cache.keys().next().value); }

/* ---------- пересылка ---------- */
function send(res, status, headers, body) { res.writeHead(status, headers); res.end(body); }
function json(res, status, obj, extra) { send(res, status, Object.assign({'Content-Type': 'application/json; charset=utf-8'}, extra || {}), JSON.stringify(obj)); }

async function pipeUpstream(req, res, url, opts) {
  const cors = corsHeaders(req);
  const headers = {'User-Agent': UA};
  if (req.headers.range) headers['Range'] = req.headers.range;
  if (opts && opts.forwardAuth) {
    if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    if (req.headers.origin) headers['Origin'] = req.headers.origin;
  }
  const init = {method: req.method === 'HEAD' ? 'HEAD' : req.method, headers, redirect: 'follow'};
  if (req.method === 'POST') { init.body = Readable.toWeb(req); init.duplex = 'half'; }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), (opts && opts.timeoutMs) || 30000);
  init.signal = ctl.signal;
  let up;
  try { up = await fetch(url, init); }
  catch (e) { clearTimeout(t); return json(res, 502, {error: 'upstream_unreachable', detail: String(e.message || e)}, cors); }
  clearTimeout(t);
  const out = Object.assign({}, cors);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'last-modified', 'etag']) {
    const v = up.headers.get(h); if (v) out[h] = v;
  }
  if (!out['accept-ranges'] && /audio|octet-stream/.test(out['content-type'] || '')) out['accept-ranges'] = 'bytes';
  res.writeHead(up.status, out);
  if (!up.body || req.method === 'HEAD') return res.end();
  const body = Readable.fromWeb(up.body);
  body.on('error', () => res.destroy());
  req.on('close', () => body.destroy());
  body.pipe(res);
}

async function cachedJson(req, res, key, urls) {
  const cors = corsHeaders(req);
  const c = cacheGet(key);
  if (c) return send(res, 200, Object.assign({'Content-Type': c.type, 'X-Cache': 'HIT'}, cors), c.body);
  let lastErr = null;
  for (const url of urls) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
      const r = await fetch(url, {headers: {'User-Agent': UA}, signal: ctl.signal, redirect: 'follow'});
      clearTimeout(t);
      const body = Buffer.from(await r.arrayBuffer());
      const type = r.headers.get('content-type') || 'application/json';
      if (r.ok) cachePut(key, {body, type, at: Date.now()});
      return send(res, r.status, Object.assign({'Content-Type': type, 'X-Cache': 'MISS'}, cors), body);
    } catch (e) { lastErr = e; }
  }
  return json(res, 502, {error: 'upstream_unreachable', detail: String(lastErr && lastErr.message || lastErr)}, cors);
}

/* ---------- проверка связи ---------- */
async function probe(url, init) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  const started = Date.now();
  try { const r = await fetch(url, Object.assign({headers: {'User-Agent': UA}, signal: ctl.signal}, init || {})); clearTimeout(t); return {ok: r.ok, status: r.status, ms: Date.now() - started}; }
  catch (e) { clearTimeout(t); return {ok: false, error: String(e.message || e).slice(0, 120)}; }
}

/* ---------- сервер ---------- */
const server = http.createServer(async (req, res) => {
  const cors = corsHeaders(req);
  try {
    if (req.method === 'OPTIONS') return send(res, 204, cors, '');
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (!rateOk(ip)) return json(res, 429, {error: 'rate_limited'}, cors);
    if (!originAllowed(req)) return json(res, 403, {error: 'origin_not_allowed'}, cors);
    const u = new URL(req.url, 'http://x');
    const path = u.pathname;

    if (path === '/' || path === '/health') {
      const [audius, radio, ai] = await Promise.all([
        probe(AUDIUS_API + '/tracks/trending?limit=1&app_name=ChatProxy'),
        probe(RADIO_BASES[0] + '/json/stats'),
        AI_UPSTREAM ? probe(AI_UPSTREAM + '/') : Promise.resolve({ok: false, error: 'AI_UPSTREAM не задан'}),
      ]);
      return json(res, 200, {ok: true, service: 'chat-proxy', audius, radio, ai, aiConfigured: !!AI_UPSTREAM}, cors);
    }

    if (path.startsWith('/audius/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, {error: 'method'}, cors);
      const rest = path.slice('/audius'.length).replace(/^\/v1/, '');
      const target = AUDIUS_API + rest + u.search;
      if (/\/stream$/.test(rest)) return pipeUpstream(req, res, target, {timeoutMs: 60000});    // аудио — потоком, с перемоткой
      if (/^\/tracks\/(trending|search)/.test(rest)) return cachedJson(req, res, 'a:' + rest + u.search, [target]);
      return pipeUpstream(req, res, target, {timeoutMs: 20000});
    }

    if (path.startsWith('/radio/')) {
      if (req.method !== 'GET') return json(res, 405, {error: 'method'}, cors);
      const rest = path.slice('/radio'.length) + u.search;
      return cachedJson(req, res, 'r:' + rest, RADIO_BASES.map(b => b + rest));
    }

    if (path.startsWith('/ai/')) {
      if (!AI_UPSTREAM) return json(res, 503, {error: 'ai_upstream_not_configured'}, cors);
      const rest = path.slice('/ai'.length) + u.search;
      return pipeUpstream(req, res, AI_UPSTREAM + rest, {forwardAuth: true, timeoutMs: 120000});
    }

    return json(res, 404, {error: 'not_found'}, cors);
  } catch (e) {
    if (!res.headersSent) json(res, 500, {error: 'proxy_error', detail: String(e.message || e)}, cors);
    else res.destroy();
  }
});
server.requestTimeout = 0;
server.listen(PORT, () => console.log(`chat-proxy слушает порт ${PORT}; сайт: ${ALLOWED.join(', ') || '*'}; ИИ: ${AI_UPSTREAM || 'не задан'}`));
