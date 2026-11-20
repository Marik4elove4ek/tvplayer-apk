// Разбор плейлистов M3U и загрузка Xtream Codes (то же, что в Android-версии, Data.kt)
const M3U = (() => {
  const ATTR = /([\w-]+)="([^"]*)"/g;
  const STREAM = /^\s*[A-Za-z][A-Za-z0-9+.\-]*:\/\//;

  function attrs(line) {
    const m = {};
    let a;
    ATTR.lastIndex = 0;
    while ((a = ATTR.exec(line))) m[a[1].toLowerCase()] = a[2];
    return m;
  }

  // Запятая перед названием канала (запятые внутри кавычек пропускаем)
  function nameComma(line) {
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') q = !q;
      else if (c === ',' && !q) return i;
    }
    return -1;
  }

  function parse(text, noGroup, channelName) {
    const channels = [];
    const epg = [];
    let name = null, logo = null, group = null, tvgId = null, cu = null;
    let defCu = null;   // архив, заданный для всего плейлиста в строке #EXTM3U
    for (let raw of text.split(/\r?\n/)) {
      const line = raw.trim().replace(/^﻿/, '');
      if (!line) continue;
      if (/^#EXTM3U/i.test(line)) {
        const h = attrs(line);
        if (h.catchup || h['catchup-source'] || h['catchup-days']) defCu = { type: h.catchup || null, src: h['catchup-source'] || null, days: +h['catchup-days'] || 0 };
        for (const k of ['url-tvg', 'x-tvg-url', 'tvg-url']) {
          if (h[k]) h[k].split(',').map(s => s.trim()).filter(s => /^http/i.test(s)).forEach(s => { if (!epg.includes(s)) epg.push(s); });
        }
      } else if (/^#EXTINF/i.test(line)) {
        const a = attrs(line);
        logo = a['tvg-logo'] || null;
        group = a['group-title'] || null;
        tvgId = a['tvg-id'] || null;
        // Архив передач: catchup="…" catchup-source="…" catchup-days="…" (или timeshift / tvg-rec — дни)
        const days = +(a['catchup-days'] || a.timeshift || a['tvg-rec'] || 0) || 0;
        cu = a.catchup || a['catchup-source'] || days ? { type: a.catchup || null, src: a['catchup-source'] || null, days } : null;
        if (cu && cu.type === 'disabled') cu = null;
        const c = nameComma(line);
        name = c >= 0 ? line.substring(c + 1).trim() : null;
        if (!name) name = a['tvg-name'] || null;
      } else if (/^#EXTGRP:/i.test(line)) {
        group = line.substring(line.indexOf(':') + 1).trim();
      } else if (line.startsWith('#')) {
        // прочие служебные строки
      } else if (STREAM.test(line)) {
        channels.push({
          name: name || channelName(channels.length + 1),
          url: line.split('|')[0].trim(),
          logo, group: group || noGroup, epgId: tvgId,
          ...catchupFields(cu || defCu)
        });
        name = logo = group = tvgId = cu = null;
      }
    }
    return { channels, epg };
  }

  function catchupFields(c) {
    return c ? { catchup: c.type || '', catchupSource: c.src || null, catchupDays: c.days || 0 } : {};
  }

  function normalizeServer(input) {
    let s = input.trim().replace(/\s+/g, '').split('?')[0];
    for (const tail of ['/get.php', '/player_api.php', '/xmltv.php', '/panel_api.php', '/c/', '/live/']) {
      const i = s.toLowerCase().indexOf(tail);
      if (i > 0) s = s.substring(0, i);
    }
    s = s.replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s;
  }

  async function getText(url) {
    let r;
    try {
      r = await fetch(url, { cache: 'no-store' });
    } catch (e) {
      throw new LupoError('err_no_connection');
    }
    if (!r.ok) throw new LupoError('err_http', r.status);
    return r.text();
  }

  async function loadXtream(p, noGroup, channelName) {
    const base = normalizeServer(p.server);
    const u = encodeURIComponent(p.user), pw = encodeURIComponent(p.pass);
    const api = `${base}/player_api.php?username=${u}&password=${pw}`;
    let auth;
    try { auth = JSON.parse(await getText(api)); } catch (e) {
      if (e instanceof LupoError) throw e;
      throw new LupoError('err_not_xtream');
    }
    const info = auth && auth.user_info;
    if (!info || Number(info.auth) !== 1) throw new LupoError('err_bad_login');
    if (info.status && !/^active$/i.test(info.status)) throw new LupoError('err_inactive', info.status);
    const cats = {};
    try { JSON.parse(await getText(api + '&action=get_live_categories')).forEach(c => { cats[c.category_id] = c.category_name; }); } catch (e) { }
    const list = JSON.parse(await getText(api + '&action=get_live_streams'));
    // В браузере и на телевизорах поток HLS (.m3u8) играет надёжнее, чем .ts
    const channels = list.filter(o => o.stream_id != null).map(o => ({
      name: o.name || channelName(o.stream_id),
      url: `${base}/live/${u}/${pw}/${o.stream_id}.m3u8`,
      logo: o.stream_icon || null,
      group: cats[o.category_id] || noGroup,
      epgId: o.epg_channel_id || null,
      // Архив у провайдера Xtream: tv_archive = 1, tv_archive_duration — дни
      ...(Number(o.tv_archive) === 1 ? { catchup: 'xc', catchupDays: +o.tv_archive_duration || 0 } : {})
    }));
    if (!channels.length) throw new LupoError('err_no_channels');
    return { channels, epg: [`${base}/xmltv.php?username=${u}&password=${pw}`] };
  }

  function guessEpg(url, channels) {
    try {
      const u = new URL(url);
      const user = u.searchParams.get('username'), pass = u.searchParams.get('password');
      if (/get\.php$/i.test(u.pathname) && user && pass)
        return u.origin + '/xmltv.php?username=' + encodeURIComponent(user) + '&password=' + encodeURIComponent(pass);
    } catch (e) { }
    // Каналы с одного сервера Xtream: http://сервер/live/логин/пароль/номер.ts (или без /live/)
    const counts = new Map();
    channels.slice(0, 300).forEach(c => {
      const m = /^(https?:\/\/[^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/\d+(\.\w+)?(\?|$)/.exec(c.url || '');
      if (m) { const k = m[1] + '|' + m[2] + '|' + m[3]; counts.set(k, (counts.get(k) || 0) + 1); }
    });
    let best = null, n = 0;
    counts.forEach((v, k) => { if (v > n) { n = v; best = k; } });
    if (!best || n < Math.min(5, channels.length)) return null;
    const [origin, user, pass] = best.split('|');
    return origin + '/xmltv.php?username=' + encodeURIComponent(decodeURIComponent(user)) + '&password=' + encodeURIComponent(decodeURIComponent(pass));
  }

  async function load(p, noGroup, channelName) {
    const own = (p.epg || '').split(/[,\n ;]/).map(s => s.trim()).filter(s => /^http/i.test(s));
    let res;
    if (p.type === 'xtream') res = await loadXtream(p, noGroup, channelName);
    else {
      res = parse(await getText(p.url.trim()), noGroup, channelName);
      if (!res.channels.length) throw new LupoError('err_empty_playlist');
      // В плейлисте нет ссылки на программу — ищем её сами: у провайдеров Xtream (ссылка get.php или каналы вида
      // /live/логин/пароль/номер) программа лежит на том же сервере в xmltv.php. Вписывать её вручную не нужно
      if (!res.epg.length) {
        const g = guessEpg(p.url.trim(), res.channels);
        if (g) res.epg.push(g);
      }
    }
    // Адрес программы, вписанный в сам плейлист, помним отдельно — он показывается серым в поле EPG
    res.epgPlaylist = res.epg.slice();
    if (own.length) res.epg = own;
    return res;
  }

  return { parse, load, normalizeServer };
})();

class LupoError extends Error {
  constructor(key, arg) { super(key); this.key = key; this.arg = arg; }
}
