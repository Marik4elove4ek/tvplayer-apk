// Программа передач (XMLTV, в том числе .gz). Читается по частям, хранятся только нужные каналы
// и только с «сейчас минус 3 часа» до «плюс 4 дня» — чтобы хватало памяти телевизора.
const Epg = (() => {
  let byKey = new Map();      // ключ канала → [{s, e, t, d}] по времени
  const listeners = [];

  function norm(s) {
    return (s || '').toLowerCase().replace(/ё/g, 'е')
      .replace(/\b(hd|fhd|uhd|4k|sd|hevc|orig|\+\d+)\b/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
  }

  // «20261118180000 +0200» → миллисекунды
  function time(v) {
    const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-]\d{4})?/.exec(v || '');
    if (!m) return NaN;
    let ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    if (m[7]) {
      const sign = m[7][0] === '-' ? -1 : 1;
      ms -= sign * (+m[7].slice(1, 3) * 60 + +m[7].slice(3, 5)) * 60000;
    }
    return ms;
  }

  function unxml(s) {
    return (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
  }

  // Поток текста файла: сам распаковывает .gz (встроенно, а на старых телевизорах — через pako)
  async function textChunks(url, onText) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const gz = /\.gz(\?|$)/i.test(url) || /gzip/i.test(r.headers.get('content-type') || '');
    if (r.body && (!gz || typeof DecompressionStream !== 'undefined')) {
      let stream = r.body;
      if (gz) stream = stream.pipeThrough(new DecompressionStream('gzip'));
      const reader = stream.getReader();
      const dec = new TextDecoder('utf-8');
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        onText(dec.decode(value, { stream: true }));
      }
      onText(dec.decode());
      return;
    }
    const buf = new Uint8Array(await r.arrayBuffer());
    const plain = buf[0] === 0x1f && buf[1] === 0x8b ? pako.inflate(buf) : buf;
    onText(new TextDecoder('utf-8').decode(plain));
  }

  // Каналы плейлиста → ключи программы: по tvg-id и по названию
  function wanted(channels) {
    const ids = new Map(), names = new Map();
    channels.forEach(c => {
      const k = keyOf(c);
      if (c.epgId) ids.set(c.epgId, k), ids.set(c.epgId.toLowerCase(), k);
      names.set(norm(c.name), k);
    });
    return { ids, names };
  }
  function keyOf(c) { return c.epgId ? 'id:' + c.epgId : 'n:' + norm(c.name); }

  async function load(urls, channels) {
    const { ids, names } = wanted(channels);
    const map = new Map();
    // Каналы с архивом: для них храним и прошлые передачи (столько дней, сколько архив)
    const deep = new Set();
    let archDays = 0;
    channels.forEach(c => { if (window.Catchup && Catchup.has(c)) { deep.add(keyOf(c)); archDays = Math.max(archDays, Catchup.days(c)); } });
    const near = Date.now() - 3 * 3600e3;
    const from = Math.min(near, Date.now() - archDays * 86400e3), to = Date.now() + 4 * 86400e3;
    report = [];
    for (const url of urls) {
      const t0 = Date.now();
      let found = 0;
      const idToKeys = new Map();   // id канала в файле → ключи наших каналов
      let rest = '';
      try {
        await textChunks(url, text => {
          rest += text;
          let pos = 0;
          for (;;) {
            const ci = rest.indexOf('<channel', pos), pi = rest.indexOf('<programme', pos);
            if (ci < 0 && pi < 0) { pos = rest.length; break; }
            const isCh = ci >= 0 && (pi < 0 || ci < pi);
            const start = isCh ? ci : pi;
            const endTag = isCh ? '</channel>' : '</programme>';
            const end = rest.indexOf(endTag, start);
            if (end < 0) { pos = start; break; }
            const block = rest.slice(start, end + endTag.length);
            pos = end + endTag.length;
            if (isCh) {
              const id = (/id="([^"]*)"/.exec(block) || [])[1];
              if (!id) continue;
              const keys = new Set();
              if (ids.has(id)) keys.add(ids.get(id));
              if (ids.has(id.toLowerCase())) keys.add(ids.get(id.toLowerCase()));
              block.replace(/<display-name[^>]*>([\s\S]*?)<\/display-name>/g, (_, n) => {
                const k = names.get(norm(unxml(n)));
                if (k) keys.add(k);
                return '';
              });
              if (keys.size) { idToKeys.set(id, [...keys]); found++; }
            } else {
              const ch = (/channel="([^"]*)"/.exec(block) || [])[1];
              let keys = idToKeys.get(ch);
              if (!keys && ids.has(ch)) keys = [ids.get(ch)];
              if (!keys) continue;
              const s = time((/start="([^"]*)"/.exec(block) || [])[1]);
              const e = time((/stop="([^"]*)"/.exec(block) || [])[1]);
              if (!(e > from && s < to)) continue;
              const t = unxml((/<title[^>]*>([\s\S]*?)<\/title>/.exec(block) || [])[1]).trim();
              const d = unxml((/<desc[^>]*>([\s\S]*?)<\/desc>/.exec(block) || [])[1]).trim();
              const item = { s, e, t, d };
              keys.forEach(k => {
                if (e <= near && !deep.has(k)) return;
                if (!map.has(k)) map.set(k, []);
                map.get(k).push(item);
              });
            }
          }
          rest = rest.slice(pos);
          // Не держим в памяти мусор между блоками
          if (rest.length > 4e6) rest = rest.slice(-1e6);
        });
        report.push({ url, ok: true, n: found, sec: Math.round((Date.now() - t0) / 1000) });
      } catch (e) {
        console.warn('EPG', url, e);
        report.push({ url, ok: false, err: (e && (e.message || e.name)) || String(e) });
      }
    }
    lastLoad = { time: Date.now(), report };
    map.forEach(list => list.sort((a, b) => a.s - b.s));
    // Первый источник, в котором канал нашёлся, главный: повторы из других убираем
    map.forEach((list, k) => {
      const out = [];
      list.forEach(p => { if (!out.length || p.s >= out[out.length - 1].e - 60000) out.push(p); });
      map.set(k, out);
    });
    return map;
  }

  // Сохранённая программа (IndexedDB): открывается сразу, свежая грузится в фоне
  function db() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('lupo', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('epg');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function saveCache(id, map) {
    try {
      const d = await db();
      d.transaction('epg', 'readwrite').objectStore('epg').put({ time: Date.now(), data: [...map] }, id);
    } catch (e) { }
  }
  async function readCache(id) {
    try {
      const d = await db();
      return await new Promise(res => {
        const r = d.transaction('epg').objectStore('epg').get(id);
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => res(null);
      });
    } catch (e) { return null; }
  }

  let report = [], lastLoad = null;
  // Загрузить заново, не глядя на сохранённую (кнопка «Обновить сейчас» в настройках телепрограммы)
  async function reload(playlistId, urls, channels) {
    if (!urls.length) return;
    const fresh = await load(urls, channels);
    try { localStorage.setItem('epgrep.' + playlistId, JSON.stringify(lastLoad)); } catch (e) { }
    if (fresh.size) { byKey = fresh; saveCache(playlistId, fresh); listeners.forEach(f => f()); }
  }
  function lastReport(playlistId) { try { return JSON.parse(localStorage.getItem('epgrep.' + playlistId)); } catch (e) { return null; } }

  async function open(playlistId, urls, channels) {
    const cached = await readCache(playlistId);
    if (cached) { byKey = new Map(cached.data); listeners.forEach(f => f()); }
    if (!urls.length) return;
    if (cached && Date.now() - cached.time < 6 * 3600e3) return;
    const fresh = await load(urls, channels);
    try { localStorage.setItem('epgrep.' + playlistId, JSON.stringify(lastLoad)); } catch (e) { }
    if (fresh.size) {
      byKey = fresh;
      saveCache(playlistId, fresh);
      listeners.forEach(f => f());
    }
  }

  function list(c) { return byKey.get(keyOf(c)) || []; }
  function now(c, at) {
    at = at || Date.now();
    const l = list(c);
    const i = l.findIndex(p => p.s <= at && p.e > at);
    return i < 0 ? null : { cur: l[i], next: l[i + 1] || null };
  }

  return { open, reload, lastReport, list, now, onChange: f => listeners.push(f), time };
})();
