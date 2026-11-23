// Программа передач (XMLTV, в том числе .gz). Читается по частям, хранятся только нужные каналы
// и только с «сейчас минус 3 часа» до «плюс 4 дня» — чтобы хватало памяти телевизора.
const Epg = (() => {
  // Программа каждого плейлиста отдельно: плейлист → (ключ канала → [{s, e, t, d}] по времени).
  // current — открытый плейлист; каналы из других плейлистов (общее избранное) несут свой _pl
  const maps = new Map();
  let current = null;
  const EMPTY = new Map();
  const loading = new Set();
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
      // В главном потоке (запасной путь, без фонового) каждые 50 мс работы отдаём телевизору пульт и экран
      const main = typeof window !== 'undefined';
      let since = Date.now();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        onText(dec.decode(value, { stream: true }));
        if (main && Date.now() - since > 50) { await new Promise(r => setTimeout(r, 0)); since = Date.now(); }
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

  // Описание передачи в памяти — до 300 знаков (в сохранённой программе — до 200): длинные описания
  // сотен каналов на четыре дня вперёд и съедали память телевизора
  const DESC = 300;

  // Что брать из файла: какие каналы и за какое время
  function want(channels) {
    const { ids, names } = wanted(channels);
    // Каналы с архивом: для них храним и прошлые передачи (столько дней, сколько архив)
    const deep = new Set();
    let archDays = 0;
    channels.forEach(c => { if (window.Catchup && Catchup.has(c)) { deep.add(keyOf(c)); archDays = Math.max(archDays, Catchup.days(c)); } });
    const near = Date.now() - 3 * 3600e3;
    const from = Math.min(near, Date.now() - archDays * 86400e3), to = Date.now() + 4 * 86400e3;
    return { ids, names, deep, near, from, to };
  }

  // Разбор файлов программы. Работает и в главном потоке, и в фоновом (Worker): берёт только то, что передано
  // в ctx, и функции norm, time, unxml, textChunks
  async function parseAll(urls, ctx) {
    const { ids, names, deep, near, from, to } = ctx;
    const map = new Map(), report = [];
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
              const d = unxml((/<desc[^>]*>([\s\S]*?)<\/desc>/.exec(block) || [])[1]).trim().slice(0, DESC);
              // Отдельная копия строк: иначе название и описание остаются «окошками» в огромный кусок файла,
              // и весь файл программы (сотни МБ) так и остаётся в памяти телевизора
              const item = JSON.parse(JSON.stringify({ s, e, t, d }));
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
    map.forEach(list => list.sort((a, b) => a.s - b.s));
    // Первый источник, в котором канал нашёлся, главный: повторы из других убираем
    map.forEach((list, k) => {
      const out = [];
      list.forEach(p => { if (!out.length || p.s >= out[out.length - 1].e - 60000) out.push(p); });
      map.set(k, out);
    });
    return { map, report };
  }

  // Большой файл программы (у некоторых провайдеров 200 МБ) разбирается в фоновом потоке: экран и пульт
  // не зависают, а всё, что нужно только для разбора, после него освобождается вместе с потоком.
  // Поток собирается из этих же функций (отдельного файла нет: версии через интернет приходят без новых файлов).
  // Нет фонового потока или в нём нечем распаковать .gz (старые телевизоры) — разбираем по-старому, кусками
  let workerSrc = null;
  function inWorker(urls, ctx) {
    return new Promise((res, rej) => {
      if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return rej(new Error('no worker'));
      if (!workerSrc) {
        workerSrc = URL.createObjectURL(new Blob([
          'const DESC = ' + DESC + ';\n',
          [norm, time, unxml, textChunks, parseAll].map(f => f.toString()).join('\n'),
          '\nself.onmessage = async e => {' +
          ' try { const r = await parseAll(e.data.urls, e.data.ctx);' +
          ' self.postMessage({ ok: true, list: [...r.map], report: r.report }); }' +
          ' catch (x) { self.postMessage({ ok: false, err: String((x && (x.message || x.name)) || x) }); } };'
        ], { type: 'text/javascript' }));
      }
      let w;
      try { w = new Worker(workerSrc); } catch (e) { return rej(e); }
      // Поток молчит слишком долго — останавливаем его, чтобы не держал память
      const timer = setTimeout(() => { w.terminate(); rej(new Error('worker timeout')); }, 10 * 60000);
      const done = () => { clearTimeout(timer); w.terminate(); };
      w.onmessage = e => { done(); e.data.ok ? res({ map: new Map(e.data.list), report: e.data.report }) : rej(new Error(e.data.err)); };
      w.onerror = e => { done(); e.preventDefault && e.preventDefault(); rej(new Error((e && e.message) || 'worker error')); };
      // В фоновом потоке нет адреса страницы: относительные адреса делаем полными
      w.postMessage({ urls: urls.map(u => { try { return new URL(u, location.href).href; } catch (e) { return u; } }), ctx });
    });
  }

  async function load(urls, channels) {
    const ctx = want(channels);
    let r;
    try {
      r = await inWorker(urls, ctx);
      // В фоновом потоке нечем распаковать .gz — тот источник разбираем здесь
      const again = r.report.filter(x => !x.ok && /pako|DecompressionStream/i.test(x.err || '')).map(x => x.url);
      if (again.length) {
        const h = await parseAll(again, ctx);
        h.map.forEach((list, k) => { if (!r.map.has(k)) r.map.set(k, list); });
        r.report = r.report.map(x => h.report.find(y => y.url === x.url) || x);
      }
    } catch (e) {
      console.warn('EPG worker', e);
      r = await parseAll(urls, ctx);
    }
    report = r.report;
    lastLoad = { time: Date.now(), report };
    return r.map;
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
  // В память телевизора (её всего ~80 МБ на всё) кладётся сжатая программа: вперёд на полтора суток с описаниями
  // до 200 знаков, прошлые дни архива — без описаний. Полная живёт, только пока Лупо открыт
  let tight = false;   // места в телевизоре мало: сохраняется программа только открытого плейлиста
  async function saveCache(id, map) {
    if (tight && id !== current) return;
    try {
      const from = Date.now() - 3 * 3600e3, to = Date.now() + 36 * 3600e3;
      const data = [];
      map.forEach((list, k) => {
        // Прошедшие передачи (они есть только у каналов с архивом) — без описаний, только время и название
        const l = list.filter(p => p.s < to).map(p => (p.e > from ? { s: p.s, e: p.e, t: p.t, d: (p.d || '').slice(0, 200) } : { s: p.s, e: p.e, t: p.t, d: '' }));
        if (l.length) data.push([k, l]);
      });
      const d = await db();
      d.transaction('epg', 'readwrite').objectStore('epg').put({ time: Date.now(), data }, id);
    } catch (e) { }
  }
  // Убрать сохранённую программу плейлистов, которых больше нет (после восстановления копии у плейлистов новые номера)
  async function prune(ids) {
    try {
      const d = await db();
      const st = d.transaction('epg', 'readwrite').objectStore('epg');
      const r = st.getAllKeys();
      r.onsuccess = () => (r.result || []).forEach(k => { if (!ids.includes(k)) st.delete(k); });
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

  // Скачивание и разбор — по одному плейлисту за раз: две большие программы одновременно не помещаются в память
  let queue = Promise.resolve();
  function queued(fn) { const p = queue.then(fn, fn); queue = p.catch(() => { }); return p; }

  // В памяти — программа открытого плейлиста и ещё не больше двух других (общее избранное, папка другого
  // плейлиста в списке слева). Остальные убираются из памяти; при надобности снова читаются из сохранённой
  const KEEP_OTHERS = 2;
  function put(id, map) {
    maps.delete(id); maps.set(id, map);   // в конец — самая свежая
    const others = [...maps.keys()].filter(k => k !== current);
    while (others.length > KEEP_OTHERS) { const k = others.shift(); maps.delete(k); fetched.delete(k); }
  }

  // Защита от круга «загрузка программы → телевизор закрыл Лупо → Лупо открылся → загрузка снова»:
  // перед загрузкой ставится отметка, после — снимается. Если Лупо дважды подряд закрылся во время загрузки
  // программы одного плейлиста, её 6 часов не скачиваем (работает сохранённая), а в журнал пишем, почему
  const MARK = 'lupo.epgLoading';
  function log(line) { try { if (typeof Store !== 'undefined') Store.addNote(new Date().toLocaleString() + ' — ' + line); } catch (e) { } }
  (function lastRun() {
    try {
      const m = JSON.parse(localStorage.getItem(MARK) || 'null');
      if (m && !m.logged) {
        m.logged = true;
        localStorage.setItem(MARK, JSON.stringify(m));
        setTimeout(() => log('EPG: Lupo closed while loading the TV guide (' + m.id + ', ' + m.n + 'x)'), 5000);
      }
    } catch (e) { }
  })();
  function blocked(id) {
    try { const m = JSON.parse(localStorage.getItem(MARK) || 'null'); return !!(m && m.id === id && m.n >= 2 && Date.now() - m.at < 6 * 3600e3); } catch (e) { return false; }
  }
  function mark(id) {
    try {
      const m = JSON.parse(localStorage.getItem(MARK) || 'null');
      localStorage.setItem(MARK, JSON.stringify({ id, n: m && m.id === id ? m.n + 1 : 1, at: Date.now() }));
    } catch (e) { }
  }
  function unmark() { try { localStorage.removeItem(MARK); } catch (e) { } }

  async function fetchFresh(playlistId, urls, channels) {
    if (blocked(playlistId)) { log('EPG: TV guide download skipped for 6 h (' + playlistId + ')'); return null; }
    mark(playlistId);
    try { return await load(urls, channels); }
    finally { unmark(); }
  }

  // Загрузить заново, не глядя на сохранённую (кнопка «Обновить сейчас» в настройках телепрограммы)
  async function reload(playlistId, urls, channels) {
    if (!urls.length) return;
    try { localStorage.removeItem(MARK); } catch (e) { }   // человек сам попросил — пробуем, даже если раньше закрывалось
    const fresh = await queued(() => fetchFresh(playlistId, urls, channels));
    if (!fresh) return;
    try { localStorage.setItem('epgrep.' + playlistId, JSON.stringify(lastLoad)); } catch (e) { }
    if (fresh.size) { put(playlistId, fresh); fetched.set(playlistId, Date.now()); saveCache(playlistId, fresh); listeners.forEach(f => f()); }
  }
  function lastReport(playlistId) { try { return JSON.parse(localStorage.getItem('epgrep.' + playlistId)); } catch (e) { return null; } }

  // Программа плейлиста: сохранённая — сразу, свежая (если сохранённой больше 6 часов) — в фоне
  const fetched = new Map();   // плейлист → когда его программа получена
  async function ensure(playlistId, urls, channels) {
    if (loading.has(playlistId)) return;
    // Программа этого плейлиста уже в памяти и свежая — не читаем и не скачиваем её заново при каждом обращении
    if (maps.has(playlistId) && Date.now() - (fetched.get(playlistId) || 0) < 6 * 3600e3) return;
    loading.add(playlistId);
    try {
      const cached = await readCache(playlistId);
      if (cached) { put(playlistId, new Map(cached.data)); fetched.set(playlistId, cached.time); listeners.forEach(f => f()); }
      if (!urls.length || (cached && Date.now() - cached.time < 6 * 3600e3)) return;
      // Мало места: свежую программу скачиваем только для открытого плейлиста (у других она бы не сохранилась
      // и скачивалась бы заново при каждом заходе)
      if (tight && playlistId !== current) {
        if (!maps.has(playlistId)) put(playlistId, new Map());
        fetched.set(playlistId, Date.now());
        return;
      }
      const fresh = await queued(() => fetchFresh(playlistId, urls, channels));
      if (fresh) try { localStorage.setItem('epgrep.' + playlistId, JSON.stringify(lastLoad)); } catch (e) { }
      if (fresh && fresh.size) { put(playlistId, fresh); fetched.set(playlistId, Date.now()); saveCache(playlistId, fresh); listeners.forEach(f => f()); }
      else {
        // Не скачалась — следующая попытка не раньше чем через 10 минут (а не при каждом обращении)
        if (!maps.has(playlistId)) put(playlistId, new Map());
        fetched.set(playlistId, Date.now() - 6 * 3600e3 + 600e3);
      }
    } finally { loading.delete(playlistId); }
  }
  // Открыт плейлист: его программа — главная
  async function open(playlistId, urls, channels) {
    current = playlistId;
    return ensure(playlistId, urls, channels);
  }

  function list(c) { return (maps.get((c && c._pl) || current) || EMPTY).get(keyOf(c)) || []; }
  function now(c, at) {
    at = at || Date.now();
    const l = list(c);
    const i = l.findIndex(p => p.s <= at && p.e > at);
    return i < 0 ? null : { cur: l[i], next: l[i + 1] || null };
  }

  // Плейлист изменили (другой адрес): его сохранённая программа больше не подходит
  async function forget(id) {
    maps.delete(id); fetched.delete(id);
    try { const d = await db(); d.transaction('epg', 'readwrite').objectStore('epg').delete(id); } catch (e) { }
  }
  return { prune, forget, setTight: on => { tight = !!on; }, open, ensure, reload, lastReport, list, now, onChange: f => listeners.push(f) };
})();
