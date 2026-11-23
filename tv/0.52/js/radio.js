// Экран радио (канал только со звуком) — как в Android (AudioGlow.kt, RadioSongs.kt):
// тёмный фон, по которому переливаются цвета значка станции, большой значок, название станции и песня.
// Песня берётся из пометок списка HLS (EXT-X-DATERANGE) или с сайта станции.
const Radio = (() => {
  const box = document.getElementById('radio');
  const canvas = document.getElementById('radio-bg');
  const ctx = canvas.getContext('2d');
  const DEFAULT = [[61, 90, 254], [124, 77, 255], [0, 184, 212]];   // как в Android
  let colors = DEFAULT, on = false, raf = 0, ch = null, songTimer = null, token = 0;
  const t0 = performance.now();

  // Радиостанция по папке, названию или адресу — у неё и не должно быть картинки
  function looks(c) {
    const s = ((c.group || '') + ' ' + (c.name || '')).toLowerCase();
    if (/radio|радио|радіо|רדיו|راديو/.test(s)) return true;
    if (/(^|[\s.\d])fm($|[\s\d])/.test(s)) return true;
    const u = (c.url || '').split('?')[0].split('|')[0].toLowerCase();
    return /\.(mp3|aac|ogg)$/.test(u) || u.includes('icecast') || u.includes('/radio');
  }

  // Картинка через fetch → свой адрес: так её цвета можно прочитать (картинка с чужого сайта иначе «закрыта»)
  async function ownImage(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    const u = URL.createObjectURL(await r.blob());
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = u; });
    return img;
  }
  // Главные цвета значка (как в Android, AudioGlow.colorsOf): до трёх сочных оттенков; серое, белое и чёрное не считаются
  function hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
  }
  function rgb(h, s, v) {
    const f = n => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
    return [f(5), f(3), f(1)];
  }
  function colorsOf(img) {
    const n = 24, c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, n, n);
    const d = g.getImageData(0, 0, n, n).data;
    const bins = 12, weight = new Array(bins).fill(0), sumH = new Array(bins).fill(0), sumS = new Array(bins).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const [h, s, v] = hsv(d[i], d[i + 1], d[i + 2]);
      if (s < 0.25 || v < 0.2) continue;
      const b = Math.min(bins - 1, Math.floor(h / (360 / bins)));
      const w = s * v;
      weight[b] += w; sumH[b] += h * w; sumS[b] += s * w;
    }
    const top = [...Array(bins).keys()].filter(b => weight[b] > 0).sort((a, b) => weight[b] - weight[a]);
    if (!top.length) return DEFAULT;
    const hues = top.filter(b => weight[b] >= weight[top[0]] * 0.15).slice(0, 3).map(b => [sumH[b] / weight[b], Math.max(0.7, sumS[b] / weight[b])]);
    // Значок одного цвета — добавляем соседние оттенки, чтобы фон всё-таки переливался
    if (hues.length === 1) { hues.push([(hues[0][0] + 35) % 360, hues[0][1]]); hues.push([(hues[0][0] + 325) % 360, hues[0][1]]); }
    return hues.map(x => rgb(x[0], x[1], 1));
  }

  // ---------- Живой фон, как в Android (AudioGlow.kt): пять плавающих пятен, искры и круги от значка ----------
  // Звук родного плеера Samsung программе не слышен, поэтому «дыхание» фона идёт ровным ритмом, а не точно в такт музыке
  const SPOTS = 5, SPARKS = 46, RINGS = 3, RING_GAP = 4000, RING_LIFE = 2400;
  const SPEED_X = [0.46, 0.34, 0.26, 0.52, 0.38], SPEED_Y = [0.37, 0.29, 0.41, 0.31, 0.48], PHASE = [0, 2.1, 4.2, 1.2, 3.3];
  const spark = [];
  (function () {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < SPARKS; i++) spark.push({ x: rnd(), y: rnd(), size: 0.8 + rnd() * 1.6, speed: 0.006 + rnd() * 0.016, phase: rnd() * 6.28 });
  })();
  const rings = new Array(RINGS).fill(0);
  let lastRing = 0, nextGap = 5000;
  function spotColor(i) {
    const c = colors[i % colors.length];
    if (i < colors.length) return c;
    const [h, s, v] = hsv(c[0], c[1], c[2]);
    return rgb((h + 22 * Math.floor(i / colors.length)) % 360, s, v);
  }
  function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
  function frame(nowMs) {
    if (!on) return;
    const w = canvas.width = 960, h = canvas.height = 540;   // половинный размер — телевизору легче
    const t = (nowMs - t0) / 1000;
    // «Музыка»: мягкая пульсация, как средний уровень песни
    const level = Math.max(0, Math.min(1, 0.45 + 0.3 * Math.sin(t * 2.1) * Math.sin(t * 0.37 + 1) + 0.15 * Math.sin(t * 5.3)));
    ctx.fillStyle = '#07080c';
    ctx.fillRect(0, 0, w, h);
    const r = Math.max(w, h) * 0.6;
    for (let i = 0; i < SPOTS; i++) {
      const c = spotColor(i);
      const cx = w * (0.5 + 0.44 * Math.sin(t * SPEED_X[i] + PHASE[i]));
      const cy = h * (0.5 + 0.42 * Math.cos(t * SPEED_Y[i] + PHASE[i] * 1.7));
      const size = (i < 3 ? 1 : 0.62) * (1 + 0.22 * level) * r;
      const a = (170 + 85 * level) / 255;
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, size);
      gr.addColorStop(0, rgba(c, a * 190 / 255));
      gr.addColorStop(0.5, rgba(c, a * 85 / 255));
      gr.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, w, h);
    }
    // Круги от значка: изредка, бледные, растут и тают
    if (nowMs - lastRing > nextGap) {
      const free = rings.indexOf(0);
      if (free >= 0) { rings[free] = nowMs; lastRing = nowMs; nextGap = RING_GAP + Math.random() * 3000; }
    }
    const logo = document.getElementById('radio-logo').getBoundingClientRect();
    const box2 = box.getBoundingClientRect();
    const k = w / (box2.width || 1920);
    const ox = ((logo.left + logo.width / 2) - box2.left) * k || w / 2;
    const oy = ((logo.top + logo.height / 2) - box2.top) * k || h / 2;
    const r0 = (logo.width / 2) * k || Math.min(w, h) * 0.17;
    const grow = Math.min(w, h) * 0.42;
    for (let i = 0; i < RINGS; i++) {
      if (!rings[i]) continue;
      const p = (nowMs - rings[i]) / RING_LIFE;
      if (p >= 1) { rings[i] = 0; continue; }
      const ease = 1 - (1 - p) * (1 - p);
      ctx.strokeStyle = `rgba(255,255,255,${0.27 * (1 - p)})`;
      ctx.lineWidth = 2.5 - 1.5 * p;
      ctx.beginPath();
      ctx.arc(ox, oy, r0 + grow * ease, 0, 6.2832);
      ctx.stroke();
    }
    // Искры: мелкие светящиеся точки медленно плывут вверх и мерцают
    for (let i = 0; i < SPARKS; i++) {
      const s = spark[i];
      let y = (s.y - t * s.speed) % 1;
      if (y < 0) y += 1;
      const x = s.x + 0.012 * Math.sin(t * 0.5 + s.phase);
      const tw = 0.5 + 0.5 * Math.sin(t * (0.9 + s.speed * 30) + s.phase);
      const a = Math.min(255, 40 + 120 * tw + 90 * level) / 255;
      const c = colors[i % colors.length];
      ctx.fillStyle = rgba([c[0] | 0xb0, c[1] | 0xb0, c[2] | 0xb0], a);
      ctx.beginPath();
      ctx.arc(x * w, y * h, s.size * 1.5 * (1 + 0.5 * level), 0, 6.2832);
      ctx.fill();
    }
    // Значок слегка покачивается
    document.getElementById('radio-card').style.transform = `translateY(${Math.sin(t * 0.8) * 8}px)`;
    setTimeout(() => { raf = requestAnimationFrame(frame); }, 33);
  }

  function setArt(url) {
    const big = document.getElementById('radio-logo');
    big.innerHTML = '';
    const my = token;
    if (!url) { big.textContent = '♪'; colors = DEFAULT; return; }
    ownImage(url).then(img => {
      if (my !== token) return;
      big.innerHTML = '';
      big.appendChild(img);
      try { colors = colorsOf(img); } catch (e) { colors = DEFAULT; }
    }).catch(() => {
      if (my !== token) return;
      const img = new Image();
      img.onerror = () => { big.textContent = '♪'; };
      img.src = url;
      big.innerHTML = '';
      big.appendChild(img);
      colors = DEFAULT;
    });
  }

  function show(c, name) {
    token++;
    ch = c;
    document.getElementById('radio-name').textContent = name;
    setSong(null);
    setArt(c.logo || '');
    box.classList.remove('hidden');
    if (!on) { on = true; raf = requestAnimationFrame(frame); }
    clearTimeout(songTimer);
    closeWs();
    media = ''; noTags = 0;
    // Первый раз — через 3 секунды: к этому времени плеер уже открыл свой список, и песню читаем из него
    const my = token;
    songTimer = setTimeout(() => pollSong(my), 3000);
  }
  function hide() {
    token++;
    closeWs();
    on = false;
    cancelAnimationFrame(raf);
    clearTimeout(songTimer);
    ch = null;
    box.classList.add('hidden');
  }
  // Спрятать на время (телепрограмма поверх) и показать снова
  function visible(v) { if (ch) box.classList.toggle('hidden', !v); }

  let lastSong = '';
  function setSong(s) {
    const key = s ? s.title + '|' + s.artist : '';
    document.getElementById('radio-song').textContent = s ? s.title : '';
    document.getElementById('radio-artist').textContent = s ? s.artist : '';
    if (key !== lastSong) {
      lastSong = key;
      if (ch) setArt(s && s.art ? s.art : ch.logo || '');
    }
  }

  // ---------- Песня «сейчас в эфире» ----------
  function siteSource(u) {
    if (/radiovanya/i.test(u)) return 'https://radiovanya.ru/api/v5/playlists/0/';
    if (/radio-holding\.ru\/marusya/i.test(u)) return 'https://h6.marus.fm/tracks?timestamp={ts}&region=default';
    if (/hostingradio\.ru\/dfm\//i.test(u)) return 'https://dfm.ru/api/n/legend?slug=dfm';
    if (/rusradio\.ru\/t\/radio/i.test(u)) return 'https://rusradio.ru/api/n/legend?slug=russkoe-radio';
    return null;
  }
  function text(o, keys) { for (const k of keys) { const v = o && o[k]; if (typeof v === 'string' && v.trim()) return v.trim(); } return null; }
  function artistOf(o) {
    for (const k of ['artist', 'performer', 'singer', 'author']) {
      const v = o && o[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (v && typeof v === 'object') { const n = text(v, ['name', 'title']); if (n) return n; }
    }
    return null;
  }
  function firstItem(n, depth) {
    if (Array.isArray(n)) return n[0] && typeof n[0] === 'object' ? n[0] : null;
    if (n && typeof n === 'object') for (const k of ['items', 'tracks', 'data', 'result', 'history']) {
      const v = n[k];
      if (Array.isArray(v)) return v[0] && typeof v[0] === 'object' ? v[0] : null;
      if (v && typeof v === 'object' && depth < 3) { const f = firstItem(v, depth + 1); if (f) return f; }
    }
    return null;
  }
  const COVER = ['imglarge', 'coverUrl', 'cover', 'image', 'img', 'picture', 'artwork', 'imgsmall'];
  function parseSite(json, source) {
    const item = firstItem(json, 0) || (json && typeof json === 'object' && !Array.isArray(json) ? json : null);
    if (!item) return null;
    const inner = item.track && typeof item.track === 'object' ? item.track : null;
    const obj = inner || item;
    let title = text(obj, ['title', 'name', 'song']) || (inner ? null : text(item, ['track']));
    let artist = artistOf(obj) || artistOf(item);
    const cover = text(obj, COVER) || text(item, COVER);
    if (!title) return null;
    if (!artist && title.includes(' - ')) { artist = title.split(' - ')[0].trim(); title = title.slice(title.indexOf(' - ') + 3).trim(); }
    if (!title) return null;
    let art = '';
    if (cover && /^http/.test(cover)) art = cover;
    else if (cover && cover.startsWith('/')) art = source.slice(0, source.indexOf('/', source.indexOf('://') + 3)) + cover;
    return { title, artist: artist || '', art };
  }
  // Пометки списка HLS: многие станции пишут исполнителя и название туда (EXT-X-DATERANGE).
  // Раньше каждые 20 секунд заново открывался главный список станции, а у hostingradio.ru (Like FM, Рекорд…)
  // каждое такое открытие — новый сеанс. Сеансы копились, сайт отвечал «Too many concurrent requests», и сам
  // эфир на телевизоре (тот же адрес в интернете) запускался долго и спотыкался раз в 20 секунд.
  // Теперь читаем тот же список, который уже играет плеер; если плеер играет главный список — один раз
  // выбираем из него поток и дальше читаем только его (один постоянный сеанс, а не новый каждые 20 секунд)
  let media = '', noTags = 0;
  async function getText(u) {
    const r = await fetch(u, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return { text: await r.text(), url: r.url || u };
  }
  async function hlsSong(url) {
    const ok = r => r && /^#EXTM3U/.test(r.text) && !/#EXT-X-STREAM-INF/.test(r.text);   // список с кусочками эфира
    const tryGet = async u => { try { return await getText(u); } catch (e) { return null; } };
    let r = null, master = null;
    const own = typeof Player !== 'undefined' && Player.mediaUrl ? Player.mediaUrl() : '';
    if (own && /^https?:/i.test(own)) {
      const x = await tryGet(own);
      if (ok(x)) r = x;
      else if (x && /#EXT-X-STREAM-INF/.test(x.text)) master = x;
    }
    if (!r && media) { const x = await tryGet(media); if (ok(x)) r = x; else media = ''; }
    if (!r) {
      if (!master) master = await getText(url);
      if (!/#EXT-X-STREAM-INF/.test(master.text)) r = master;
      else {
        const line = master.text.split(/\r?\n/).find(l => l && !l.startsWith('#'));
        if (!line) return null;
        media = new URL(line.trim(), master.url).href;
        r = await getText(media);
      }
    }
    let best = null, first = null, tags = 0;
    r.text.split(/\r?\n/).filter(l => l.startsWith('#EXT-X-DATERANGE')).forEach(tag => {
      tags++;
      const get = k => ((new RegExp(k + '="([^"]*)"')).exec(tag) || [])[1] || '';
      const title = get('X-TITLE').trim();
      if (!title) return;
      const s = { title, artist: get('X-ARTIST').trim(), art: get('X-COVER-IMAGE-URL').trim() };
      if (!first) first = s;
      const start = Date.parse(get('START-DATE'));
      if (!start || start <= Date.now()) best = s;
    });
    noTags = tags ? 0 : noTags + 1;
    return best || first;
  }
  // Станции, у которых песня и обложка приходят по постоянному соединению (WebSocket) от hostingradio.ru:
  // так их показывает сам сайт станции. Новое Радио идёт одним потоком (без списка HLS), поэтому песню берём отсюда
  function wsSource(u) {
    if (/stream\.newradio\.ru\//i.test(u)) return 'wss://meta.hostingradio.ru/emg/novoeradio/ws?format=emg&subformat=full';
    return null;
  }
  let ws = null;
  function closeWs() { if (ws) { try { ws.onclose = null; ws.close(); } catch (e) { } ws = null; } }
  function openWs(src, my) {
    closeWs();
    if (typeof WebSocket === 'undefined') return;
    try { ws = new WebSocket(src); } catch (e) { ws = null; return; }
    ws.onmessage = e => {
      if (my !== token) return;
      try {
        const c = JSON.parse(e.data).current;
        if (c && c.title) setSong({ title: String(c.title).trim(), artist: String(c.artist || '').trim(), art: String(c.cover || '').replace('/300x300/', '/600x600/') });
      } catch (x) { }
    };
    // Соединение оборвалось — через 20 секунд открываем снова (пока станция на экране)
    ws.onclose = () => { ws = null; if (my === token && ch) songTimer = setTimeout(() => openWs(src, my), 20000); };
  }
  async function pollSong(my) {
    if (my !== token || !ch) return;
    const wsrc = wsSource(ch.url);
    if (wsrc) { openWs(wsrc, my); return; }
    let s = null, more = true;
    try {
      const site = siteSource(ch.url);
      if (site) {
        const src = site.replace('{ts}', Math.floor(Date.now() / 1000));
        s = parseSite(await (await fetch(src, { cache: 'no-store' })).json(), src);
      } else if (/m3u8/i.test(ch.url)) {
        s = await hlsSong(ch.url);
        // В списке станции песен нет вовсе (три раза подряд) — больше его не читаем
        if (noTags >= 3) more = false;
      } else more = false;
    } catch (e) { }
    if (my !== token) return;
    if (s) setSong(s);
    if (more) songTimer = setTimeout(() => pollSong(my), 20000);
  }

  return { looks, show, hide, visible, isOn: () => !!ch };
})();
