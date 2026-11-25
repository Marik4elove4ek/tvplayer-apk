// Архив передач (catch-up) — то же, что в Android-версии (Catchup.kt).
// Строит ссылку на прошедшую передачу в формате провайдера: flussonic, shift, append, default (catchup-source) или Xtream.
const Catchup = (() => {
  const DAY = 86400e3;
  const PH = /\$?\{([a-zA-Z-]+)(?::([^}]*))?\}/g;

  // Есть ли у канала архив
  function has(c) { return !!c && (c.catchup !== undefined || c.catchupDays > 0); }
  // Сколько дней архива (если провайдер не сказал — 7, не больше 14)
  function days(c) { return Math.min(14, Math.max(1, c.catchupDays > 0 ? c.catchupDays : 7)); }
  // Передача ещё есть в архиве
  function available(c, p) {
    const now = Date.now();
    return has(c) && p.s < now && p.s > now - days(c) * DAY;
  }

  // Ссылка на передачу с момента start (по умолчанию — с начала передачи)
  function url(c, p, start) {
    if (!has(c)) return null;
    const s = start || p.s;
    const now = Date.now();
    const stop = Math.min(p.e, now);
    const src = c.catchupSource;
    switch ((c.catchup || '').toLowerCase()) {
      case 'default': return src ? fill(src, s, stop) : shift(c.url, s);
      case 'append': return src ? c.url + fill(src, s, stop) : shift(c.url, s);
      case 'shift': case 'timeshift': return shift(c.url, s);
      case 'flussonic': case 'flussonic-hls': return flussonic(c.url, s, stop, false);
      case 'flussonic-ts': case 'fs': return flussonic(c.url, s, stop, true);
      case 'xc': return xtream(c.url, s, stop);
    }
    if (src) return /^http/i.test(src) ? fill(src, s, stop) : c.url + fill(src, s, stop);
    if (/\/live\/[^/]+\/[^/]+\/\d+/.test(c.url)) return xtream(c.url, s, stop);
    if (looksFlussonic(c.url)) return flussonic(c.url, s, stop, /mpegts$/.test(c.url));
    return shift(c.url, s);
  }

  function looksFlussonic(u) {
    const last = u.split('?')[0].split('/').pop();
    return ['mpegts', 'video.m3u8', 'index.m3u8', 'mono.m3u8'].includes(last);
  }
  // ?utc=начало&lutc=сейчас
  function shift(u, start) {
    return u + (u.includes('?') ? '&' : '?') + 'utc=' + Math.floor(start / 1000) + '&lutc=' + Math.floor(Date.now() / 1000);
  }
  // Flussonic: …/video-НАЧАЛО-ДЛИТЕЛЬНОСТЬ.m3u8 или …/timeshift_abs-НАЧАЛО.ts
  function flussonic(u, start, stop, ts) {
    const qi = u.indexOf('?');
    const query = qi >= 0 ? u.slice(qi + 1) : '';
    const path = qi >= 0 ? u.slice(0, qi) : u;
    const last = path.split('/').pop();
    const base = path.slice(0, path.lastIndexOf('/'));
    const s = Math.floor(start / 1000);
    const dur = Math.max(60, Math.floor((stop - start) / 1000));
    let built;
    if (ts || last === 'mpegts') built = base + '/timeshift_abs-' + s + '.ts';
    else if (last.endsWith('.m3u8')) built = base + '/' + last.slice(0, -5) + '-' + s + '-' + dur + '.m3u8';
    else built = path + '/index-' + s + '-' + dur + '.m3u8';
    return query ? built + '?' + query : built;
  }
  // Xtream Codes: /timeshift/логин/пароль/минуты/ГГГГ-ММ-ДД:ЧЧ-ММ/номер.расширение
  function xtream(u, start, stop) {
    const m = /^(.*)\/live\/([^/]+)\/([^/]+)\/(\d+)(\.\w+)?/.exec(u);
    if (!m) return shift(u, start);
    const minutes = Math.max(1, Math.floor((stop - start) / 60000));
    return m[1] + '/timeshift/' + m[2] + '/' + m[3] + '/' + minutes + '/' + xcDate(m[1], start) + '/' + m[4] + '.ts';   // как в Android: архив Xtream проверен с .ts
  }
  // Дата передачи по часам сервера Xtream (пояс сервер сообщил при входе); не сообщил — по часам телевизора, как раньше
  function xcDate(base, start) {
    const d = new Date(start);
    try {
      const host = new URL(base).host.toLowerCase();
      const tz = JSON.parse(localStorage.getItem('lupo.xtz') || '{}')[host];
      if (tz) {
        const p = {};
        new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          .formatToParts(d).forEach(x => { p[x.type] = x.value; });
        if (p.year && p.month && p.day && p.hour && p.minute) return p.year + '-' + p.month + '-' + p.day + ':' + (p.hour === '24' ? '00' : p.hour) + '-' + p.minute;
      }
    } catch (e) { }
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ':' + two(d.getHours()) + '-' + two(d.getMinutes());
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  // Части даты по UTC, как в Android-версии
  function part(t, f) {
    const d = new Date(t);
    switch (f) {
      case 'Y': return String(d.getUTCFullYear());
      case 'y': return String(d.getUTCFullYear()).slice(2);
      case 'm': return two(d.getUTCMonth() + 1);
      case 'd': return two(d.getUTCDate());
      case 'H': return two(d.getUTCHours());
      case 'M': return two(d.getUTCMinutes());
      case 'S': return two(d.getUTCSeconds());
    }
    return f;
  }
  function format(t, f) { return [...f].map(ch => part(t, ch)).join(''); }
  // Подставляет время передачи в шаблон провайдера: {utc}, {lutc}, {duration}, {Y}-{m}-{d} и т. п.
  function fill(tpl, start, stop) {
    const now = Date.now();
    const s = Math.floor(start / 1000), e = Math.floor(stop / 1000), n = Math.floor(now / 1000);
    const dur = Math.max(60, e - s);
    return tpl.replace(PH, (all, raw, arg) => {
      arg = arg || '';
      if (['Y', 'm', 'd', 'H', 'M', 'S'].includes(raw)) return part(start, raw);
      const div = +arg > 0 ? +arg : 1;
      switch (raw.toLowerCase()) {
        case 'utc': case 'start': case 'timestamp-start': return arg ? format(start, arg) : String(s);
        case 'lutc': case 'now': case 'timestamp': return arg ? format(now, arg) : String(n);
        case 'utcend': case 'end': return arg ? format(stop, arg) : String(e);
        case 'duration': return String(Math.floor(dur / div));
        case 'offset': return String(Math.floor((n - s) / div));
        case 'start-year': return part(start, 'Y');
        case 'start-mon': return part(start, 'm');
        case 'start-day': return part(start, 'd');
        case 'start-hour': return part(start, 'H');
        case 'start-min': return part(start, 'M');
        case 'start-sec': return part(start, 'S');
      }
      return all;
    });
  }

  return { has, days, available, url };
})();
