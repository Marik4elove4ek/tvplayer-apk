// Экран радио (канал только со звуком) — как в Android (AudioGlow.kt, RadioSongs.kt):
// тёмный фон, по которому переливаются цвета значка станции, большой значок, название станции и песня.
// Песня берётся из пометок списка HLS (EXT-X-DATERANGE) или с сайта станции.
const Radio = (() => {
  const box = document.getElementById('radio');
  const canvas = document.getElementById('radio-bg');
  const ctx = canvas.getContext('2d');
  const DEFAULT = [[76, 141, 255], [123, 92, 255], [40, 200, 220], [255, 92, 170]];
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
  // Яркие и насыщенные цвета картинки (до четырёх)
  function colorsOf(img) {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    const buckets = new Map();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const r = d[i], gr = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, gr, b), mn = Math.min(r, gr, b);
      if (mx < 60 || mx - mn < 40) continue;   // тёмное и серое не берём
      const k = (r >> 5) + ',' + (gr >> 5) + ',' + (b >> 5);
      const o = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
      o.n++; o.r += r; o.g += gr; o.b += b;
      buckets.set(k, o);
    }
    const top = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 4).map(o => [o.r / o.n | 0, o.g / o.n | 0, o.b / o.n | 0]);
    return top.length ? top : DEFAULT;
  }

  // Живой фон: цветные пятна медленно плавают и дышат
  function frame(now) {
    if (!on) return;
    const w = canvas.width = 960, h = canvas.height = 540;   // половинный размер — телевизору легче
    const s = (now - t0) / 1000;
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const c = colors[i % colors.length];
      const x = w * (0.5 + 0.38 * Math.sin(s * (0.11 + i * 0.03) + i * 1.7));
      const y = h * (0.5 + 0.34 * Math.cos(s * (0.09 + i * 0.025) + i * 2.3));
      const r = h * (0.55 + 0.12 * Math.sin(s * 0.7 + i));
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.42)`);
      gr.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
    // Значок слегка покачивается
    document.getElementById('radio-card').style.transform = `translateY(${Math.sin(s * 0.8) * 8}px)`;
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
    pollSong(token);
  }
  function hide() {
    token++;
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
  // Пометки списка HLS: многие станции пишут исполнителя и название туда (EXT-X-DATERANGE)
  async function hlsSong(url) {
    let text = await (await fetch(url, { cache: 'no-store' })).text();
    if (/#EXT-X-STREAM-INF/.test(text)) {
      const line = text.split(/\r?\n/).find(l => l && !l.startsWith('#'));
      if (!line) return null;
      text = await (await fetch(new URL(line.trim(), url).href, { cache: 'no-store' })).text();
    }
    let best = null, first = null;
    text.split(/\r?\n/).filter(l => l.startsWith('#EXT-X-DATERANGE')).forEach(tag => {
      const get = k => ((new RegExp(k + '="([^"]*)"')).exec(tag) || [])[1] || '';
      const title = get('X-TITLE').trim();
      if (!title) return;
      const s = { title, artist: get('X-ARTIST').trim(), art: get('X-COVER-IMAGE-URL').trim() };
      if (!first) first = s;
      const start = Date.parse(get('START-DATE'));
      if (!start || start <= Date.now()) best = s;
    });
    return best || first;
  }
  async function pollSong(my) {
    if (my !== token || !ch) return;
    let s = null;
    try {
      const site = siteSource(ch.url);
      if (site) {
        const src = site.replace('{ts}', Math.floor(Date.now() / 1000));
        s = parseSite(await (await fetch(src, { cache: 'no-store' })).json(), src);
      } else if (/m3u8/i.test(ch.url)) s = await hlsSong(ch.url);
    } catch (e) { }
    if (my !== token) return;
    if (s) setSong(s);
    songTimer = setTimeout(() => pollSong(my), 20000);
  }

  return { looks, show, hide, visible, isOn: () => !!ch };
})();
