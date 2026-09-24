/* ╔══════════════════════════════════════════════════════════════════════╗
   ║                    DEMO-СЕРВИС ДЛЯ ПРОВЕРКИ                            ║
   ║   Притворяется прокси: отдаёт демо-каталог, звук, радио и ответы ИИ    ║
   ╚══════════════════════════════════════════════════════════════════════╝

   Зачем: проверить в приложении всю музыку и расшифровку, не поднимая настоящий сервер.
   Куда вставить: Cloudflare → Workers & Pages → Create Worker → Edit code → вставить → Deploy.
   Затем в приложении: Админ-панель → Сервер → «Прокси для музыки и ИИ» → адрес этого воркера → Проверить → Сохранить.

   Что отдаёт:
     /health                          проверка (в приложении три зелёные галочки)
     /audius/v1/tracks/trending|search каталог из 8 демо-треков
     /audius/v1/tracks/{id}/stream     звук: короткая мелодия, у каждого трека своя (с перемоткой)
     /radio/json/stations/search       4 демо-радиостанции
     /ai/transcribe, /ai/translate     ответы «расшифровки» и «перевода»
     /art/{n}.svg                      обложки

   Это демо: настоящей музыки здесь нет, только сгенерированные мелодии.
   ══════════════════════════════════════════════════════════════════════ */

const TRACKS = [
  {id: '1', title: 'Полёт над городом', artist: 'Demo Project', note: 392.0, dur: 24, genre: 'Electronic'},
  {id: '2', title: 'Тёплый вечер', artist: 'Ночной эфир', note: 329.6, dur: 24, genre: 'Lo-Fi'},
  {id: '3', title: 'Дорога домой', artist: 'Demo Project', note: 261.6, dur: 24, genre: 'Pop'},
  {id: '4', title: 'Северный ветер', artist: 'Аврора', note: 440.0, dur: 24, genre: 'Ambient'},
  {id: '5', title: 'Танцы до утра', artist: 'Клуб 99', note: 523.3, dur: 24, genre: 'House'},
  {id: '6', title: 'Тихий дождь', artist: 'Аврора', note: 293.7, dur: 24, genre: 'Ambient'},
  {id: '7', title: 'Первый снег', artist: 'Ночной эфир', note: 349.2, dur: 24, genre: 'Lo-Fi'},
  {id: '8', title: 'Огни трассы', artist: 'Клуб 99', note: 466.2, dur: 24, genre: 'Hip-Hop/Rap'},
];
const STATIONS = [
  {stationuuid: 'demo-1', name: 'Демо-радио: Хиты', tags: 'pop,hits', country: 'Демо'},
  {stationuuid: 'demo-2', name: 'Демо-радио: Спокойное', tags: 'chillout', country: 'Демо'},
  {stationuuid: 'demo-3', name: 'Демо-радио: Танцы', tags: 'dance', country: 'Демо'},
  {stationuuid: 'demo-4', name: 'Демо-радио: Разговоры', tags: 'talk', country: 'Демо'},
];
const COLORS = [['#6F8BFF', '#C150D6'], ['#FF8A5B', '#FF3B6B'], ['#2FB8A8', '#3A7BD5'], ['#FFB300', '#FF6A88'],
                ['#7F00FF', '#E100FF'], ['#141E30', '#3A6073'], ['#11998E', '#38EF7D'], ['#654EA3', '#EAAFC8']];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
};
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {status, headers: {...CORS, ...extra, 'Content-Type': 'application/json; charset=utf-8'}});

/* мелодия: простая гамма на заданной ноте, 16 кГц моно 16 бит */
function makeWav(baseHz, seconds) {
  const rate = 16000, n = Math.floor(rate * seconds);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  const steps = [0, 2, 4, 5, 7, 9, 11, 12];
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const step = steps[Math.floor(t * 2) % steps.length];
    const hz = baseHz * Math.pow(2, step / 12);
    const env = Math.min(1, (t * 2 % 1) * 6) * (1 - (t * 2 % 1) * 0.65);      // мягкая атака и затухание
    const sample = Math.sin(2 * Math.PI * hz * t) * 0.45 + Math.sin(2 * Math.PI * hz * 2 * t) * 0.12;
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample * env)) * 22000, true);
  }
  return new Uint8Array(buf);
}
function audioResponse(bytes, range) {
  const total = bytes.length;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? +m[1] : 0;
      const end = m[2] ? Math.min(+m[2], total - 1) : total - 1;
      if (start < total) {
        return new Response(bytes.subarray(start, end + 1), {status: 206, headers: {...CORS,
          'Content-Type': 'audio/wav', 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${total}`, 'Cache-Control': 'public, max-age=3600'}});
      }
    }
  }
  return new Response(bytes, {status: 200, headers: {...CORS,
    'Content-Type': 'audio/wav', 'Content-Length': String(total), 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600'}});
}
const apiTrack = (t, origin) => ({
  id: t.id, title: t.title, duration: t.dur, genre: t.genre, is_streamable: true,
  user: {name: t.artist, handle: t.artist},
  artwork: {'150x150': `${origin}/art/${t.id}.svg`, '480x480': `${origin}/art/${t.id}.svg`, '1000x1000': `${origin}/art/${t.id}.svg`},
});

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const origin = url.origin;
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: CORS});

    if (path === '/' || path === '/health') {
      return json({ok: true, service: 'chat-proxy-DEMO', demo: true,
        audius: {ok: true, status: 200, ms: 1}, radio: {ok: true, status: 200, ms: 1}, ai: {ok: true, status: 200, ms: 1}, aiConfigured: true});
    }

    let m = /^\/art\/(\d+)\.svg$/.exec(path);
    if (m) {
      const [c1, c2] = COLORS[(+m[1] - 1) % COLORS.length];
      const t = TRACKS[(+m[1] - 1) % TRACKS.length];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
        <rect width="480" height="480" fill="url(#g)"/>
        <circle cx="240" cy="205" r="92" fill="rgba(255,255,255,.92)"/><circle cx="240" cy="205" r="26" fill="${c2}"/>
        <text x="240" y="385" font-family="system-ui,sans-serif" font-size="34" font-weight="700" fill="#fff" text-anchor="middle">${t.title.replace(/[<&]/g, '')}</text>
        <text x="240" y="424" font-family="system-ui,sans-serif" font-size="24" fill="rgba(255,255,255,.85)" text-anchor="middle">демо</text></svg>`;
      return new Response(svg, {headers: {...CORS, 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400'}});
    }

    if (path.startsWith('/audius/')) {
      const rest = path.slice('/audius'.length).replace(/^\/v1/, '');
      if (rest === '/tracks/trending') {
        const genre = url.searchParams.get('genre');
        const list = genre ? TRACKS.filter(t => t.genre === genre) : TRACKS;
        return json({data: (list.length ? list : TRACKS).map(t => apiTrack(t, origin))});
      }
      if (rest === '/tracks/search') {
        const q = (url.searchParams.get('query') || '').toLowerCase();
        const list = TRACKS.filter(t => (t.title + ' ' + t.artist).toLowerCase().includes(q));
        return json({data: list.map(t => apiTrack(t, origin))});
      }
      m = /^\/tracks\/([^/]+)\/stream$/.exec(rest);
      if (m) {
        const t = TRACKS.find(x => x.id === m[1]) || TRACKS[0];
        return audioResponse(makeWav(t.note, t.dur), request.headers.get('range'));
      }
      return json({data: []});
    }

    if (path.startsWith('/radio/')) {
      const data = STATIONS.map((st, i) => ({...st, url: `${origin}/radio-stream/${i + 1}`, url_resolved: `${origin}/radio-stream/${i + 1}`,
        favicon: `${origin}/art/${i + 1}.svg`, codec: 'MP3', bitrate: 128, clickcount: 100 - i}));
      return json(data);
    }
    m = /^\/radio-stream\/(\d+)$/.exec(path);
    if (m) return audioResponse(makeWav(220 * (1 + (+m[1] % 4) * 0.25), 30), request.headers.get('range'));

    if (path === '/ai/transcribe') {
      return json({text: 'Это демо-расшифровка: сервис ответил, значит связь с ИИ работает.', language: 'ru'});
    }
    if (path === '/ai/translate') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const src = String(body.text || '').slice(0, 200);
      return json({text: `[демо-перевод] ${src}`, target: body.target || 'en', model: 'demo'});
    }
    if (path.startsWith('/ai/')) return json({ok: true, demo: true});

    return json({error: 'not_found', hint: 'Это демо-сервис. Доступны /health, /audius/…, /radio/…, /ai/…'}, 404);
  },
};
