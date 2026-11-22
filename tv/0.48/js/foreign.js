// Восстановление из резервных копий других плееров (TiviMate, Televizo и похожих) — как в Android (ForeignBackup.kt).
// Их формат нигде не описан, поэтому копию разбираем «вслепую»: раскрываем архив, просматриваем файлы
// и находим в них ссылки на плейлисты, логины Xtream, программу передач и избранные каналы.
const Foreign = (() => {
  const URL_RE = /https?:\/\/[^\s"'<>\\\u0000-\u001f]+/g;
  const NAME_COLS = ['name', 'title', 'display_name', 'channel_name', 'playlist_name', 'label'];
  const ORDER_COLS = ['position', 'sort', 'sort_order', 'order', 'idx', 'index', 'number', 'num', 'ord'];
  const td = new TextDecoder('utf-8');

  function collector() { return { m3u: new Map(), xtream: new Map(), xnames: new Map(), epg: new Set(), favorites: [], favByUrl: new Map(), encrypted: false }; }

  // ---------- ZIP ----------
  function unzip(b) {
    const out = new Map();
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    // Конец центрального каталога ищем с конца файла
    let e = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) return out;
    const count = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    for (let n = 0; n < count && p + 46 <= b.length; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = td.decode(b.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      try {
        const ln = dv.getUint16(local + 26, true), lx = dv.getUint16(local + 28, true);
        const data = b.subarray(local + 30 + ln + lx, local + 30 + ln + lx + csize);
        out.set(name, method === 0 ? data : method === 8 ? pako.inflateRaw(data) : new Uint8Array(0));
      } catch (x) { }
    }
    return out;
  }

  // ---------- Разбор ----------
  function scanBlob(bytes, c, depth) {
    if (depth > 3 || !bytes.length) return;
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {           // ZIP (так устроены копии TiviMate и Televizo)
      const entries = unzip(bytes);
      if (!televizo(entries, c)) entries.forEach(v => scanBlob(v, c, depth + 1));
      return;
    }
    const head = String.fromCharCode(...bytes.subarray(0, 15));
    if (head === 'SQLite format 3') { scanText(latin(bytes), c); return; }   // база данных: ищем ссылки прямо в ней
    if (depth === 0 && looksEncrypted(bytes)) { c.encrypted = true; return; }
    const text = td.decode(bytes);
    const tr = text.trimStart();
    if (tr.startsWith('{') || tr.startsWith('[')) { try { scanJson(JSON.parse(tr), null, c); return; } catch (x) { } }
    scanText(text, c);
  }
  function latin(b) { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; }

  function scanRow(table, row, favTable, c) {
    const name = NAME_COLS.map(k => row[k]).find(v => v && v.trim() && !v.startsWith('http')) || null;
    const find = keys => { const k = Object.keys(row).find(x => keys.includes(x)); return k ? row[k] : null; };
    const user = find(['username', 'user', 'login', 'user_name']);
    const pass = find(['password', 'pass', 'pwd']);
    const sk = Object.keys(row).find(k => String(row[k]).startsWith('http') && (k.includes('server') || k.includes('host') || k === 'url' || k.includes('portal')));
    const server = sk ? row[sk] : null;
    if (user && pass && server && !looksPlaylist(server)) {
      const key = [server.replace(/\/+$/, ''), user, pass].join('\u0000');
      if (!c.xtream.has(key)) { c.xtream.set(key, [server.replace(/\/+$/, ''), user, pass]); c.xnames.set(key, name || ''); }
    }
    Object.keys(row).forEach(k => {
      (String(row[k]).match(URL_RE) || []).forEach(u => {
        u = u.replace(/[,;)]+$/, '');
        if (isEpg(k, u)) c.epg.add(u);
        else if (isPlaylist(k, u, table) && !c.m3u.has(u)) c.m3u.set(u, name || '');
      });
    });
    const favFlag = Object.keys(row).some(k => k.includes('fav') && (row[k] === '1' || String(row[k]).toLowerCase() === 'true'));
    if ((favTable || favFlag) && name && !table.includes('playlist') && !table.includes('source')) {
      const o = ORDER_COLS.map(k => parseFloat(row[k])).find(v => !isNaN(v));
      c.favorites.push([o === undefined ? c.favorites.length : o, name]);
    }
  }
  function scanJson(v, table, c) {
    if (Array.isArray(v)) {
      v.forEach(x => { if (typeof x === 'string' && table && table.includes('fav')) c.favorites.push([c.favorites.length, x]); else scanJson(x, table, c); });
    } else if (v && typeof v === 'object') {
      const row = {};
      Object.keys(v).forEach(k => {
        const x = v[k];
        if (x && typeof x === 'object') scanJson(x, k.toLowerCase(), c);
        else if (x != null) row[k.toLowerCase()] = String(x);
      });
      const t = table || '';
      scanRow(t, row, t.includes('fav'), c);
    }
  }
  function scanText(text, c) {
    (text.match(URL_RE) || []).forEach(u => {
      u = u.replace(/[,;)]+$/, '').replace(/&amp;/g, '&');
      if (isEpg('', u)) c.epg.add(u);
      else if (looksPlaylist(u) && !c.m3u.has(u)) c.m3u.set(u, '');
    });
  }

  function isEpg(key, url) {
    const u = url.toLowerCase();
    return key.includes('epg') || key.includes('tvg') || key.includes('xmltv') || u.includes('xmltv') || u.endsWith('.xml') || u.endsWith('.xml.gz') || u.includes('epg');
  }
  function looksPlaylist(url) {
    const u = url.toLowerCase().split('#')[0];
    const file = u.split('?')[0].split('/').pop();
    if (['video.m3u8', 'index.m3u8', 'mono.m3u8', 'tracks-v1a1.m3u8'].includes(file) || file.startsWith('chunklist')) return false;
    return u.includes('.m3u') || u.includes('get.php') || u.includes('/playlist') || u.includes('type=m3u');
  }
  function isPlaylist(key, url, table) {
    if (looksPlaylist(url)) return true;
    const src = table.includes('playlist') || table.includes('source') || table.includes('provider');
    return src && (key === 'url' || key.includes('playlist') || key.includes('source')) && !/\.(png|jpg|svg)$/i.test(url);
  }
  // Почти все байты встречаются одинаково часто и текста нет — файл зашифрован (так делает TiviMate)
  function looksEncrypted(b) {
    if (b.length < 4096) return false;
    const n = Math.min(b.length, 200000), counts = new Array(256).fill(0);
    for (let i = 0; i < n; i++) counts[b[i]]++;
    let ent = 0;
    counts.forEach(x => { if (x) { const p = x / n; ent -= p * Math.log2(p); } });
    return ent > 7.9;
  }

  // ---------- Televizo ----------
  // В «…_playlistsdata» — плейлисты (название, затем ссылка), в «Favourites» — избранное, в «ManualSortIds» — его порядок
  function televizo(entries, c) {
    let data = null;
    entries.forEach((v, k) => { if (k.endsWith('playlistsdata')) data = v; });
    if (!data) return false;
    const strings = javaStrings(data);
    let lastName = null;
    for (let i = 0; i < strings.length;) {
      const s = strings[i];
      if (/^http/i.test(s)) {
        const login = strings[i + 1], password = strings[i + 2];
        if (!looksPlaylist(s) && login != null && password != null && !/^http/.test(login) && !/^http/.test(password)) {
          const x = [s.replace(/\/+$/, ''), login, password], key = x.join('\u0000');
          c.xtream.set(key, x); c.xnames.set(key, lastName || '');
          i += 3;
        } else { if (!c.m3u.has(s)) c.m3u.set(s, lastName || ''); i++; }
        lastName = null;
        continue;
      }
      if (!s.includes('/') && !s.includes(';') && s.trim()) lastName = s;
      i++;
    }
    const order = new Map();
    if (entries.has('ManualSortIds')) mmkv(entries.get('ManualSortIds')).forEach(([o, v]) => {
      if (o.playlistGroupName !== 'televizo-fav' || !o.channelName || v == null) return;
      const k = (o.playlistSource || '') + '\u0000' + o.channelName;
      order.set(k, Math.min(order.has(k) ? order.get(k) : Infinity, v));
    });
    if (entries.has('Favourites')) {
      const by = new Map();
      mmkv(entries.get('Favourites')).forEach(([o]) => {
        if (!o.channelName || !o.playlistSource) return;
        if (!by.has(o.playlistSource)) by.set(o.playlistSource, []);
        const l = by.get(o.playlistSource);
        if (!l.includes(o.channelName)) l.push(o.channelName);
      });
      by.forEach((names, url) => {
        c.favByUrl.set(url, names.map((n, i) => [order.has(url + '\u0000' + n) ? order.get(url + '\u0000' + n) : 1e6 + i, n]).sort((a, b) => a[0] - b[0]).map(x => x[1]));
      });
    }
    return c.m3u.size > 0 || c.xtream.size > 0;
  }
  // Строки из сохранённых Java-объектов (метка 0x74, длина, текст)
  function javaStrings(b) {
    const out = [];
    for (let i = 0; i + 3 <= b.length;) {
      if (b[i] === 0x74) {
        const len = (b[i + 1] << 8) | b[i + 2];
        if (len >= 1 && len <= 4000 && i + 3 + len <= b.length) {
          const s = td.decode(b.subarray(i + 3, i + 3 + len));
          if (!/[\u0000-\u001f�]/.test(s)) { out.push(s); i += 3 + len; continue; }
        }
      }
      i++;
    }
    return out;
  }
  // Записи хранилища MMKV: ключ — JSON, после него число-значение
  function mmkv(b) {
    const out = [];
    for (let i = 0; i < b.length - 2;) {
      if (b[i] === 0x7b && b[i + 1] === 0x22) {
        let end = i + 1;
        while (end < b.length && b[end] !== 0x7d) end++;
        if (end >= b.length) break;
        try {
          const o = JSON.parse(td.decode(b.subarray(i, end + 1)));
          let p = end + 1, v = null;
          if (p < b.length) {
            const vl = b[p++];
            if (vl >= 1 && vl <= 10 && p + vl <= b.length) {
              v = 0;
              for (let k = 0, sh = 0; k < vl; k++, sh += 7) { const x = b[p + k]; v += (x & 0x7f) * Math.pow(2, sh); if (!(x & 0x80)) break; }
            }
          }
          out.push([o, v]);
        } catch (x) { }
        i = end + 1;
        continue;
      }
      i++;
    }
    return out;
  }

  // get.php?username=…&password=… → сервер, логин, пароль
  function xtreamFromUrl(u) {
    if (!/get\.php/i.test(u)) return null;
    try {
      const x = new URL(u);
      const user = x.searchParams.get('username'), pass = x.searchParams.get('password');
      return user && pass ? [x.protocol + '//' + x.host, user, pass] : null;
    } catch (e) { return null; }
  }

  // Найденное: плейлисты в формате Лупо и избранное (по ссылке плейлиста или общее)
  function read(bytes) {
    const c = collector();
    try { scanBlob(bytes, c, 0); } catch (e) { }
    const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const epg = [...c.epg][0] || '';
    const pls = [];
    c.m3u.forEach((name, url) => {
      const x = xtreamFromUrl(url);
      if (x) { const k = x.join('\u0000'); if (!c.xtream.has(k)) { c.xtream.set(k, x); c.xnames.set(k, name); } return; }
      let host = 'M3U';
      try { host = new URL(url).host; } catch (e) { }
      pls.push({ id: id(), name: name || host, type: 'm3u', url, server: '', user: '', pass: '', epg, _src: url });
    });
    c.xtream.forEach((x, k) => {
      let host = 'Xtream';
      try { host = new URL(x[0]).host; } catch (e) { }
      pls.push({ id: id(), name: c.xnames.get(k) || host, type: 'xtream', url: '', server: M3U.normalizeServer(x[0]), user: x[1], pass: x[2], epg: '', _src: x[0] });
    });
    const seen = new Set();
    const playlists = pls.filter(p => { const k = p.url + p.server + p.user; if (seen.has(k)) return false; seen.add(k); return true; });
    const favorites = [...new Set(c.favorites.sort((a, b) => a[0] - b[0]).map(x => x[1]).filter(Boolean))];
    return { playlists, favorites, favByUrl: c.favByUrl, encrypted: c.encrypted };
  }

  return { read };
})();
