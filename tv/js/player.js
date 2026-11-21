// Проигрыватель Лупо для телевизоров и браузера.
// Samsung: родной плеер телевизора AVPlay (HLS, .ts, 4K, звуковые дорожки и субтитры — без ограничений браузера).
// Остальные (LG, браузер): <video> + hls.js для HLS, mpegts.js для потоков .ts.
const Player = (() => {
  const video = document.getElementById('video');
  const avBox = document.getElementById('av');
  const subBox = document.getElementById('subs');
  const av = (() => { try { return window.webapis && webapis.avplay ? webapis.avplay : null; } catch (e) { return null; } })();
  // LG (webOS): телевизор сам играет эфир HLS и потоки .ts прямо в <video> — это его «родной» плеер (легче для
  // телевизора, чем hls.js). Не справился с каналом — программа включает запасной (hls.js / mpegts.js), как на Samsung
  const lg = !av && /Web0S|webOS/i.test(navigator.userAgent);
  const handlers = {};
  let hls = null, ts = null, token = 0, avSub = -1, buffer = 'medium', rect = null;
  let playing = false, avBuf = false;

  // Окно видео: null — весь экран; иначе {x, y, w, h} в точках экрана 1920×1080 (видео в окне при телепрограмме)
  function setRect(r) {
    rect = r;
    const s = video.style;
    if (r) { s.position = 'absolute'; s.left = r.x + 'px'; s.top = r.y + 'px'; s.width = r.w + 'px'; s.height = r.h + 'px'; }
    else { s.position = ''; s.left = ''; s.top = ''; s.width = ''; s.height = ''; }
    if (av && playing) { try { av.setDisplayRect(r ? r.x : 0, r ? r.y : 0, r ? r.w : 1920, r ? r.h : 1080); } catch (e) { } }
  }

  // Поток не открылся или оборвался с ошибкой: плеер больше не считается играющим
  function fail(msg) { playing = false; emit('error', msg); }
  function emit(name, arg) { (handlers[name] || []).forEach(f => { try { f(arg); } catch (e) { } }); }
  function on(name, f) { (handlers[name] = handlers[name] || []).push(f); }
  function showSub(text) { subBox.textContent = text || ''; subBox.classList.toggle('hidden', !text); }

  // Буфер из настроек: сколько секунд набрать до начала показа
  const BUF = { small: 2, medium: 4, large: 8 };
  function setBuffer(b) { buffer = BUF[b] ? b : 'medium'; }

  function stop() {
    token++;
    playing = false;
    avBuf = false;
    showSub('');
    splitStop();
    if (av) { try { av.stop(); } catch (e) { } try { av.close(); } catch (e) { } }
    if (hls) { hls.destroy(); hls = null; }
    if (ts) { try { ts.destroy(); } catch (e) { } ts = null; }
    video.removeAttribute('src');
    try { video.load(); } catch (e) { }
    document.documentElement.classList.remove('av-on');
  }

  // web — играть через браузер (hls.js / mpegts.js) даже на Samsung: запасной движок для потоков,
  // с которыми родной плеер не справляется (часть радио HLS обрывается через 10–20 секунд)
  let engineWeb = false;
  function start(url, opts) {
    stop();
    const my = ++token;
    paused = false;
    everPlayed = false;
    engineWeb = !!(opts && opts.web) || !(av || lg);
    if (av && !engineWeb) return startAv(url, my);
    if (lg && !engineWeb) {
      video.src = url;
      playing = true;
      video.play().catch(() => { });
      // Эфир так и не пошёл (и ошибки нет) — сообщаем, программа включит запасной плеер. Фильмы ждём дольше — им можно
      if (!/\.(mp4|mkv|avi|mov|m4v|webm)(\?|$)|\/(movie|series)\//i.test(url)) setTimeout(() => { if (my === token && !everPlayed) fail('video: no picture in 12 s'); }, 12000);
      return;
    }
    const isHls = /m3u8/i.test(url);
    const isTs = !isHls && (/\.ts(\?|$)/i.test(url) || /\/live\/[^/]+\/[^/]+\/\d+(\?|$)/i.test(url));
    const sec = BUF[buffer];
    if (isHls && window.Hls && Hls.isSupported()) {
      hls = new Hls({ liveSyncDurationCount: Math.max(2, Math.round(sec / 2)), maxBufferLength: sec * 6, enableWorker: true,
        startFragPrefetch: true, manifestLoadingMaxRetry: 4, levelLoadingMaxRetry: 6, fragLoadingMaxRetry: 8, nudgeMaxRetry: 10 });
      let netRetries = 0;
      hls.on(Hls.Events.FRAG_LOADED, () => { netRetries = 0; });
      hls.subtitleDisplay = true;
      hls.on(Hls.Events.ERROR, (ev, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        // Сеть моргнула — продолжаем загрузку сами (до пяти раз подряд), а не показываем ошибку
        else if (d.type === Hls.ErrorTypes.NETWORK_ERROR && everPlayed && netRetries++ < 5) setTimeout(() => { if (my === token && hls) hls.startLoad(); }, 1000);
        else fail('HLS: ' + (d.details || d.type) + (d.response && d.response.code ? ' (' + d.response.code + ')' : ''));
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => emit('tracks'));
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => emit('tracks'));
      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (isTs && window.mpegts && mpegts.isSupported()) {
      ts = mpegts.createPlayer({ type: 'mpegts', isLive: true, url }, { enableWorker: true, liveBufferLatencyChasing: true });
      ts.on(mpegts.Events.ERROR, (type, detail) => fail('TS: ' + type + ' ' + (detail || '')));
      ts.attachMediaElement(video);
      ts.load();
    } else {
      video.src = url;
    }
    playing = true;
    video.play().catch(() => { });
  }
  video.addEventListener('error', () => { if ((!av || engineWeb) && !hls && !ts && video.error) fail('video: ' + (video.error.message || video.error.code)); });
  video.addEventListener('loadedmetadata', () => { if (!hls) emit('tracks'); });
  video.addEventListener('playing', () => { everPlayed = true; if (lg && avBuf) { avBuf = false; emit('buffering', false); } emit('playing'); });
  video.addEventListener('waiting', () => { if (lg && !engineWeb && playing && everPlayed) { avBuf = true; emit('buffering', true); } });
  // Родной плеер Samsung «застыл» молча (так бывает на радио: звук пропал, а плеер ни о чём не сообщает):
  // время показа не идёт 8 секунд — сообщаем программе, она включит канал через запасной плеер
  let avT = -1, avStuck = 0;
  setInterval(() => {
    // Пока плеер сам сообщает «подгружаю», это не «замер»: за долгой подгрузкой следит программа (15 с)
    if (!(av || lg) || engineWeb || !playing || paused || sp.length || !everPlayed || avBuf) { avStuck = 0; avT = -1; return; }
    let t = -1, st = '';
    try { if (av) { t = av.getCurrentTime(); st = av.getState(); } else { t = video.currentTime; st = video.paused || video.ended ? 'PAUSED' : ''; } } catch (e) { return; }
    if (st === 'PAUSED') { avStuck = 0; return; }
    if (t !== avT) { avT = t; avStuck = 0; return; }
    avStuck += 2;
    if (avStuck >= 8) { avStuck = 0; avT = -1; emit('frozen'); }
  }, 2000);
  // Браузерный плеер «застыл» (время не идёт): сначала подталкиваем к живому краю эфира, не помогло — эфир открывается заново
  let everPlayed = false, lastT = -1, stuck = 0;
  setInterval(() => {
    if (!playing || !engineWeb || paused || sp.length || !(hls || ts)) { stuck = 0; lastT = -1; return; }
    const t = video.currentTime;
    if (t !== lastT) { lastT = t; stuck = 0; return; }
    stuck += 2;
    if (stuck === 6 && hls) { try { hls.startLoad(); if (hls.liveSyncPosition) video.currentTime = hls.liveSyncPosition; video.play().catch(() => { }); } catch (e) { } }
    if (stuck >= 14) { stuck = 0; emit('ended'); }
  }, 2000);
  video.addEventListener('ended', () => emit('ended'));

  // ---------- Samsung AVPlay ----------
  function startAv(url, my) {
    document.documentElement.classList.add('av-on');
    try {
      av.open(url);
      av.setDisplayRect(rect ? rect.x : 0, rect ? rect.y : 0, rect ? rect.w : 1920, rect ? rect.h : 1080);
      applySize();
      // Запас перед началом и после «подгрузки»: у Samsung по умолчанию после подгрузки всего ~4 с —
      // это один кусочек эфира, и поток снова встаёт. После подгрузки набираем вдвое больше
      try { av.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', BUF[buffer]); } catch (e) { }
      try { av.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', Math.max(8, BUF[buffer] * 2)); } catch (e) { }
      av.setListener({
        onbufferingstart() { if (my === token) { avBuf = true; emit('buffering', true); } },
        onbufferingcomplete() { if (my === token) { avBuf = false; emit('buffering', false); } },
        onstreamcompleted() { if (my === token) emit('ended'); },
        onerror(e) { if (my === token) fail('AVPlay: ' + e); },
        onsubtitlechange(duration, text) { if (my === token && avSub >= 0) showSub(text); },
        onevent() { }
      });
      av.prepareAsync(() => {
        if (my !== token) return;
        try { av.play(); playing = true; everPlayed = true; } catch (e) { fail('AVPlay play: ' + (e.message || e.name || e)); return; }
        emit('playing');
        // Дорожки доступны только во время показа
        setTimeout(() => { if (my === token) emit('tracks'); }, 600);
      }, e => { if (my === token) fail('AVPlay: ' + (e && (e.message || e.name) || e)); });
    } catch (e) {
      fail('AVPlay: ' + (e.message || e.name || e));
    }
  }
  function avInfo(x) {
    let o = {};
    try { o = JSON.parse(x.extra_info); } catch (e) {
      const m = /"?(?:track_lang|language)"?\s*:\s*"([^"]*)"/.exec(x.extra_info || '');
      if (m) o.language = m[1];
    }
    return { lang: o.language || o.track_lang || '', name: '' };
  }
  function avList(type) {
    try { return webapis.avplay.getTotalTrackInfo().filter(x => x.type === type); } catch (e) { return []; }
  }
  function avCurrent(type) {
    try { const c = av.getCurrentStreamInfo().find(x => x.type === type); return c ? c.index : -1; } catch (e) { return -1; }
  }

  // ---------- Дорожки: { lang, name, on } ----------
  function audioTracks() {
    if (av && !engineWeb) { const cur = avCurrent('AUDIO'); return avList('AUDIO').map(x => Object.assign(avInfo(x), { on: x.index === cur })); }
    if (hls) return hls.audioTracks.map((a, i) => ({ lang: a.lang, name: a.name, on: i === hls.audioTrack }));
    const at = video.audioTracks;
    if (!at) return [];
    return [...Array(at.length).keys()].map(i => ({ lang: at[i].language, name: at[i].label, on: at[i].enabled }));
  }
  function setAudio(i) {
    if (av && !engineWeb) { const x = avList('AUDIO')[i]; if (x) try { av.setSelectTrack('AUDIO', x.index); } catch (e) { emit('error', 'AVPlay audio: ' + (e.message || e)); } return; }
    if (hls) { hls.audioTrack = i; return; }
    const at = video.audioTracks;
    if (at) for (let j = 0; j < at.length; j++) at[j].enabled = j === i;
  }
  function textTracks() { return [...(video.textTracks || [])].filter(x => x.kind === 'subtitles' || x.kind === 'captions'); }
  function subTracks() {
    if (av && !engineWeb) return avList('TEXT').map(x => Object.assign(avInfo(x), { on: x.index === avSub }));
    if (hls) return hls.subtitleTracks.map((s, i) => ({ lang: s.lang, name: s.name, on: i === hls.subtitleTrack }));
    return textTracks().map(x => ({ lang: x.language, name: x.label, on: x.mode === 'showing' }));
  }
  function setSub(i) {   // −1 — выключить
    if (av && !engineWeb) {
      const x = avList('TEXT')[i];
      avSub = x ? x.index : -1;
      try { if (x) { av.setSelectTrack('TEXT', x.index); av.setSilentSubtitle(false); } else av.setSilentSubtitle(true); } catch (e) { }
      if (!x) showSub('');
      return;
    }
    if (hls) { hls.subtitleTrack = i; hls.subtitleDisplay = i >= 0; return; }
    textTracks().forEach((x, j) => { x.mode = j === i ? 'showing' : 'disabled'; });
  }

  // Настоящее качество показа для «пузырей» на плашке: размер кадра, скорость потока, каналы звука
  function info() {
    const r = { w: 0, h: 0, kbps: 0, ch: 0 };
    try {
      if (av && !engineWeb) {
        av.getCurrentStreamInfo().forEach(x => {
          let o = {};
          try { o = JSON.parse(x.extra_info); } catch (e) {
            (x.extra_info || '').replace(/"?(\w+)"?\s*:\s*"([^"]*)"/g, (m, k, v) => { o[k] = v; });
          }
          if (x.type === 'VIDEO') { r.w = +o.Width || 0; r.h = +o.Height || 0; r.kbps = Math.round((+o.Bit_rate || 0) / 1000); }
          if (x.type === 'AUDIO') r.ch = +o.channels || 0;
        });
      } else {
        r.w = video.videoWidth; r.h = video.videoHeight;
        if (hls) {
          const l = hls.levels && hls.levels[hls.currentLevel];
          if (l && l.bitrate) r.kbps = Math.round(l.bitrate / 1000);
          const a = hls.audioTracks && hls.audioTracks[hls.audioTrack];
          if (a && a.channels) r.ch = parseInt(a.channels, 10) || 0;
        } else if (ts) {
          const m = ts.mediaInfo || {};
          r.ch = m.audioChannelCount || 0;
          const st = ts.statisticsInfo || {};
          if (st.speed) r.kbps = Math.round(st.speed * 8);
        }
      }
    } catch (e) { }
    return r;
  }

  // Выравнивание громкости каналов (LG, браузер): звук идёт через компрессор, тихие и громкие каналы звучат ровнее.
  // На Samsung звук выдаёт сам телевизор (AVPlay) — там это делает его собственная «Автогромкость»
  let ac = null, comp = null, src = null;
  function setLeveler(on) {
    if (av || lg) return;   // на телевизорах звук выдаёт сам телевизор — там его «Автогромкость»
    try {
      if (on && !ac) {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        src = ac.createMediaElementSource(video);
        comp = ac.createDynamicsCompressor();
        comp.threshold.value = -30; comp.knee.value = 20; comp.ratio.value = 6; comp.attack.value = 0.01; comp.release.value = 0.4;
        const gain = ac.createGain(); gain.gain.value = 1.6;
        src.connect(comp); comp.connect(gain); gain.connect(ac.destination);
        comp._out = gain;
      } else if (ac) {
        src.disconnect();
        src.connect(on ? comp : ac.destination);
      }
      if (ac && ac.state === 'suspended') ac.resume();
    } catch (e) { }
  }

  // Пауза и продолжение (архив, фильмы)
  let paused = false;
  function pause(on) {
    paused = on === undefined ? !paused : on;
    try { if (av && !engineWeb) { paused ? av.pause() : av.play(); } else { paused ? video.pause() : video.play().catch(() => { }); } } catch (e) { }
    return paused;
  }
  // Сколько миллисекунд показано от начала потока; длина потока (фильм) — 0, если неизвестна
  function pos() { try { return av && !engineWeb ? av.getCurrentTime() : Math.round(video.currentTime * 1000); } catch (e) { return 0; } }
  function duration() { try { return av && !engineWeb ? av.getDuration() : (isFinite(video.duration) ? Math.round(video.duration * 1000) : 0); } catch (e) { return 0; } }
  function seekTo(ms) {
    try { if (av && !engineWeb) av.seekTo(Math.max(0, ms)); else video.currentTime = Math.max(0, ms / 1000); } catch (e) { }
  }
  // Размер картинки: по размеру, растянуть, увеличить (края обрезаны)
  let size = 'fit';
  function applySize() {
    const m = { fit: 'PLAYER_DISPLAY_MODE_LETTER_BOX', stretch: 'PLAYER_DISPLAY_MODE_FULL_SCREEN', zoom: 'PLAYER_DISPLAY_MODE_CROPPED_FULL' };
    if (av) {
      try { av.setDisplayMethod(m[size]); } catch (e) { try { av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e2) { } }
    }
    video.style.objectFit = size === 'stretch' ? 'fill' : size === 'zoom' ? 'cover' : 'contain';
  }
  function setSize(v) { size = ['fit', 'stretch', 'zoom'].includes(v) ? v : 'fit'; applySize(); }

  // ---------- Смотреть рядом (Samsung) ----------
  // Два видео сразу на обычном (не рекламном) телевизоре Samsung: «видеомикшер» (USE_VIDEOMIXER) есть только
  // у рекламных экранов, поэтому так:
  //  1) 'multiview' — два родных плеера, второму отдаётся второй видеоресурс телевизора (IN_APP_MULTIVIEW, с Tizen 7);
  //  2) 'web' — левый канал в родном плеере, правый — в браузерном (hls.js, без звука).
  // Звук — только у левого канала
  const store = (() => { try { return window.webapis && webapis.avplaystore ? webapis.avplaystore : null; } catch (e) { return null; } })();
  let sp = [], splitWeb = null, video2 = null;
  function splitStop() {
    sp.forEach(p => { try { p.stop(); } catch (e) { } try { p.close(); } catch (e) { } });
    sp = [];
    if (splitWeb) { try { splitWeb.destroy(); } catch (e) { } splitWeb = null; }
    if (video2) { try { video2.remove(); } catch (e) { } video2 = null; }
    document.documentElement.classList.remove('split-web');
    video.muted = false;
    const s = video.style;
    s.position = ''; s.left = ''; s.top = ''; s.width = ''; s.height = '';
  }
  function avSplitPlayer(p, u, i, my, res) {
    p.open(u);
    if (res) p.setStreamingProperty('IN_APP_MULTIVIEW', res);
    p.setDisplayRect(i ? 960 : 0, 270, 960, 540);
    try { p.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e) { }
    try { p.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', 6); } catch (e) { }
    p.setListener({
      onerror(e) { if (my === token) emit('splitError', { i, msg: 'AVPlay ' + (i + 1) + ': ' + e }); },
      onstreamcompleted() { }, onbufferingstart() { }, onbufferingcomplete() { }, onevent() { }
    });
    p.prepareAsync(() => {
      if (my !== token) return;
      try { p.play(); if (i === 0) emit('playing'); } catch (e) { emit('splitError', { i, msg: 'play ' + (i + 1) + ': ' + (e.message || e.name || e) }); }
    }, e => { if (my === token) emit('splitError', { i, msg: 'prepare ' + (i + 1) + ': ' + (e && (e.message || e.name) || e) }); });
  }
  // Что сейчас с двумя половинами (для журнала и проверки «правый экран чёрный»)
  function splitState() {
    const out = [];
    sp.forEach((p, i) => { let st = '?', tm = -1; try { st = p.getState(); } catch (e) { } try { tm = p.getCurrentTime(); } catch (e) { } out.push({ i, state: st, time: tm }); });
    if (video2) [video, video2].forEach((v, i) => out.push({ i, state: 'video rs' + v.readyState + (v.error ? ' err' + v.error.code : '') + ' ' + v.videoWidth + 'x' + v.videoHeight, time: Math.round(v.currentTime * 1000), web: true, pic: v.videoWidth > 0 }));
    return out;
  }
  function split(url1, url2, mode) {
    stop();
    splitStop();
    const my = ++token;
    document.documentElement.classList.add('av-on');
    try {
      if (mode === 'web2') {
        // Оба канала в браузерных плеерах (hls.js): по правилам Samsung родной плеер и <video> вместе не играют,
        // а два <video> на части моделей могут. Звук — у левого
        document.documentElement.classList.remove('av-on');
        document.documentElement.classList.add('split-web');
        const mk = (el, u, x, i) => {
          const st = el.style;
          st.position = 'absolute'; st.left = x + 'px'; st.top = '270px'; st.width = '960px'; st.height = '540px'; st.background = '#000';
          if (/m3u8/i.test(u) && window.Hls && Hls.isSupported()) {
            const h = new Hls({ enableWorker: true, liveSyncDurationCount: 3, capLevelToPlayerSize: true });
            h.on(Hls.Events.ERROR, (ev, d) => { if (d.fatal && my === token) emit('splitError', { i, msg: 'HLS: ' + (d.details || d.type) }); });
            h.loadSource(u); h.attachMedia(el);
            return h;
          }
          el.src = u;
          return { destroy() { el.removeAttribute('src'); try { el.load(); } catch (e) { } } };
        };
        video2 = document.createElement('video');
        video2.muted = true; video2.playsInline = true;
        video.parentNode.insertBefore(video2, video.nextSibling);
        const h1 = mk(video, url1, 0, 0), h2 = mk(video2, url2, 960, 1);
        splitWeb = { destroy() { try { h1.destroy(); } catch (e) { } try { h2.destroy(); } catch (e) { } } };
        video.play().catch(() => { });
        video2.play().catch(() => { });
        return;
      }
      [url1, url2].forEach((u, i) => {
        const p = store.getPlayer();
        sp.push(p);
        avSplitPlayer(p, u, i, my, i ? 'VIDEO_VIEW_RESOURCE_SUB' : 'VIDEO_VIEW_RESOURCE_MAIN');
      });
    } catch (e) {
      emit('splitError', { i: 1, msg: (e.message || e.name || String(e)) });
    }
  }

  return { av: !!av, lg, everPlayed: () => everPlayed, splitState, usingWeb: () => engineWeb, pause, pos, duration, seekTo, setSize, isPaused: () => paused, split, splitStop, setLeveler, info, start, stop, on, audioTracks, setAudio, subTracks, setSub, setBuffer, setRect, isPlaying: () => playing, native: !!av || lg };
})();
