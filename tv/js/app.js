// Lupo Player для телевизоров (Samsung, LG) и браузера
(() => {
  const $ = id => document.getElementById(id);

  // ---------- Язык: как в Android-версии — язык системы, иначе английский ----------
  const sys = (navigator.language || 'en').toLowerCase().slice(0, 2);
  const LANG = Store.lang() || ({ iw: 'he' }[sys] || (STRINGS[sys] ? sys : 'en'));
  function t(key, ...args) {
    let s = (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key] || key;
    args.forEach(a => { s = s.replace('{}', a); });
    return s;
  }
  document.documentElement.lang = LANG;
  // Иврит и арабский: экраны как на русском — список слева, стрелки не зеркальные (просьба тестировщика 12.11).
  // Справа налево пишется только сам текст названий
  document.documentElement.dir = 'ltr';
  document.querySelectorAll('[data-t]').forEach(e => { e.textContent = t(e.dataset.t); });
  document.querySelectorAll('[data-ph]').forEach(e => { e.placeholder = t(e.dataset.ph); });

  function errorText(e) {
    if (e instanceof LupoError) return t(e.key, e.arg == null ? '' : e.arg);
    return t('err_generic', e && e.message ? e.message : '');
  }

  // Прозрачность окон поверх видео (как в Android: нет, слабая, средняя, сильная)
  const ALPHA = [0.97, 0.88, 0.75, 0.6];
  function applyLook() {
    document.documentElement.style.setProperty('--panel-alpha', ALPHA[Store.transp()] || ALPHA[1]);
    Player.setBuffer(Store.buffer());
    Player.setLeveler(Store.leveler());
  }
  applyLook();

  // ---------- Экраны ----------
  const screens = ['playlists', 'add', 'settings', 'player', 'vod'];
  let screen = 'playlists';
  function show(name) {
    screen = name;
    screens.forEach(s => $('scr-' + s).classList.toggle('hidden', s !== name));
  }

  // ---------- Плейлисты ----------
  // OK на плейлисте — меню: открыть, изменить, отключить/включить, удалить (как в Android)
  function renderPlaylists(focusId) {
    const list = Store.playlists();
    const box = $('playlists');
    box.innerHTML = '';
    $('playlists-empty').classList.toggle('hidden', list.length > 0);
    let focusEl = null;
    list.forEach(p => {
      const row = document.createElement('div');
      row.className = 'row-item focusable' + (p.off ? ' off' : '');
      row.tabIndex = 0;
      row.innerHTML = '<div class="ri-name"></div><div class="ri-sub"></div>';
      row.querySelector('.ri-name').textContent = p.name + (p.off ? ' · ' + t('playlist_off') : '');
      row.querySelector('.ri-sub').textContent = p.type === 'xtream' ? 'Xtream Codes · ' + p.server : p.url;
      row.onclick = () => playlistMenu(p);
      box.appendChild(row);
      if (p.id === focusId) focusEl = row;
    });
    return focusEl;
  }
  function playlistMenu(p) {
    const items = [
      { label: t('edit'), act: () => openAdd(p) },
      { label: t(p.off ? 'playlist_enable' : 'playlist_disable'), act: () => { setOff(p, !p.off); openPlaylists(p.id); } },
      { label: t('delete'), act: () => {
        ask(t('delete_playlist_q', p.name), t('delete'), () => {
        Store.savePlaylists(Store.playlists().filter(x => x.id !== p.id));
        Store.dropChannels(p.id);
        if (pl && pl.id === p.id) { pl = null; Player.stop(); cur = -1; }
        openPlaylists();
        }, () => openPlaylists(p.id));
      } }
    ];
    pick(p.name, items.map(i => ({ label: i.label })), i => items[i].act(), () => openPlaylists(p.id));
  }
  function setOff(p, off) {
    Store.savePlaylists(Store.playlists().map(x => x.id === p.id ? Object.assign({}, x, { off }) : x));
    p.off = off;
  }

  // «Назад» из плейлистов: к телепрограмме открытого плейлиста, иначе выход из программы
  // back — куда вернуться по «Назад» (из Настроек — обратно в Настройки)
  let playlistsBack = null;
  function openPlaylists(focusId, back) {
    if (back !== undefined) playlistsBack = back;
    show('playlists');
    const f = renderPlaylists(focusId);
    Nav.setScope($('scr-playlists'), () => {
      if (playlistsBack) return playlistsBack();
      if (pl && Store.playlists().some(x => x.id === pl.id && !x.off)) openGuide(pl); else askExit();
    });
    Nav.focus(f || $('playlists').firstChild || $('btn-add'));
  }

  // Свой вопрос вместо confirm(): на телевизоре окно браузера confirm() не показывается и сразу отвечает «да»
  function ask(question, yesLabel, onYes, onNo) {
    const back = Nav.state();
    $('pick').classList.add('center');
    pick(question, [{ label: yesLabel }, { label: t('cancel') }], i => (i === 0 ? onYes() : (onNo ? onNo() : back())), () => (onNo ? onNo() : back()));
  }
  function askExit() {
    ask(t('exit_q'), t('exit_app'), () => {
      Player.stop();
      try { if (window.tizen) tizen.application.getCurrentApplication().exit(); } catch (e) { }
      try { if (window.webOS) webOS.platformBack(); } catch (e) { }
      try { window.close(); } catch (e) { }
    });
  }


  // ---------- Добавление и изменение плейлиста ----------
  let addType = 'm3u';
  function setType(type) {
    addType = type;
    document.querySelectorAll('#scr-add .tab').forEach(b => b.classList.toggle('on', b.dataset.type === type));
    $('f-m3u').classList.toggle('hidden', type !== 'm3u');
    $('f-xtream').classList.toggle('hidden', type !== 'xtream');
  }
  document.querySelectorAll('#scr-add .tab').forEach(b => { b.onclick = () => setType(b.dataset.type); });

  let editing = null;
  function openAdd(p) {
    editing = p || null;
    show('add');
    $('add-title').textContent = t(editing ? 'edit_playlist' : 'new_playlist');
    const v = { 'f-name': 'name', 'f-url': 'url', 'f-server': 'server', 'f-user': 'user', 'f-pass': 'pass', 'f-epg': 'epg' };
    Object.keys(v).forEach(id => { $(id).value = editing ? editing[v[id]] || '' : ''; });
    $('add-error').textContent = '';
    $('add-ok').classList.add('hidden');
    setType(editing ? editing.type : 'm3u');
    epgHint();
    Nav.setScope($('scr-add'), openPlaylists);
    Nav.first();
  }
  // Поле «Программа передач» пустое — серым виден адрес программы, который провайдер вписал в сам плейлист.
  // Поле остаётся пустым, и программа берётся из плейлиста. Сменили адрес плейлиста или сервер — подсказка обычная
  function epgHint(urls) {
    if (!urls && editing) { const d = Store.channels(editing.id); urls = d && (d.epgPlaylist || (!editing.epg && d.epg)); }
    $('f-epg').placeholder = urls && urls.length ? urls.join(', ') : t('hint_epg');
  }
  ['f-url', 'f-server', 'f-user', 'f-pass'].forEach(id => { $(id).addEventListener('input', () => { $('f-epg').placeholder = t('hint_epg'); }); });

  $('btn-add').onclick = () => openAdd();
  $('btn-cancel').onclick = openPlaylists;
  function formPlaylist() {
    return {
      id: editing ? editing.id : Date.now().toString(36),
      name: $('f-name').value.trim() || t('default_playlist_name'),
      type: addType,
      url: $('f-url').value.trim(),
      server: $('f-server').value.trim(),
      user: $('f-user').value.trim(),
      pass: $('f-pass').value.trim(),
      epg: $('f-epg').value.trim()
    };
  }
  function formError(p) {
    if (p.type === 'm3u' && !p.url) return t('fill_url');
    if (p.type === 'xtream' && (!p.server || !p.user || !p.pass)) return t('fill_xtream');
    return '';
  }
  // «Проверить» — загрузить плейлист, не сохраняя: сколько каналов и адрес программы из самого плейлиста
  $('btn-check').onclick = async () => {
    const p = formPlaylist();
    $('add-ok').classList.add('hidden');
    $('add-error').textContent = formError(p);
    if ($('add-error').textContent) return;
    $('btn-check').disabled = true;
    $('add-ok').textContent = t('checking');
    $('add-ok').classList.remove('hidden');
    try {
      const data = await M3U.load(p, t('no_group'), n => t('channel_n', n));
      $('add-ok').textContent = t('check_ok', data.channels.length);
      if (!p.epg) epgHint(data.epgPlaylist);
    } catch (e) {
      $('add-ok').classList.add('hidden');
      $('add-error').textContent = t('check_fail', errorText(e));
    } finally {
      $('btn-check').disabled = false;
      Nav.focus($('btn-check'));
    }
  };
  $('btn-save').onclick = async () => {
    const p = formPlaylist();
    $('add-error').textContent = formError(p);
    if ($('add-error').textContent) return;
    $('add-ok').classList.add('hidden');
    $('btn-save').disabled = true;
    try {
      const data = await M3U.load(p, t('no_group'), n => t('channel_n', n));
      const list = Store.playlists();
      Store.savePlaylists(list.some(x => x.id === p.id) ? list.map(x => x.id === p.id ? p : x) : [...list, p]);
      Store.saveChannels(p.id, data);
      editing = null;
      openGuide(p, data);
    } catch (e) {
      $('add-error').textContent = errorText(e);
    } finally {
      $('btn-save').disabled = false;
    }
  };

  // ---------- Окно выбора справа (языки, дорожки, значения настроек): OK — выбрать, «Назад» — закрыть ----------
  function pick(title, items, onPick, back) {
    $('pick-title').textContent = title;
    const box = $('pick-list');
    box.innerHTML = '';
    let focusEl = null;
    items.forEach((it, i) => {
      const el = document.createElement('div');
      el.className = 'pick-item focusable' + (it.on ? ' on' : '');
      el.tabIndex = 0;
      el.textContent = (it.on ? '✓  ' : '') + it.label;
      el.onclick = () => { $('pick').classList.add('hidden'); $('pick').classList.remove('center'); onPick(i); };
      box.appendChild(el);
      if (it.on && !focusEl) focusEl = el;
    });
    $('pick').classList.remove('hidden');
    Nav.setScope($('pick'), () => { $('pick').classList.add('hidden'); $('pick').classList.remove('center'); back(); });
    Nav.focus(focusEl || box.firstChild);
  }

  // Длинный текст (политика, условия, лицензии, журнал): ▲▼ — листать, «Назад» — закрыть
  function doc(title, text, back) {
    $('doc-title').textContent = title;
    $('doc-text').textContent = text;
    $('doc-text').scrollTop = 0;
    $('doc').classList.remove('hidden');
    Nav.setScope($('doc'), () => { $('doc').classList.add('hidden'); back(); });
    Nav.focus($('doc-text'));
  }

  // ---------- Настройки: порядок как в Android (от главного к редкому) ----------
  const LANGS = [['en', 'English'], ['ru', 'Русский'], ['he', 'עברית'], ['fr', 'Français'], ['ar', 'العربية'],
    ['it', 'Italiano'], ['ja', '日本語'], ['ko', '한국어'], ['zh', '中文']];
  const VERSION = '0.14';
  // Если телевизор даёт странице не 1920 точек в ширину, вся страница уменьшается под экран — ничего не обрезается
  (function fitScreen() {
    const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    if (k > 0 && Math.abs(k - 1) > 0.02) {
      const b = document.body.style;
      b.width = '1920px'; b.height = '1080px'; b.transformOrigin = '0 0'; b.transform = 'scale(' + k + ')';
    }
  })();
  function langLabel(c) { const l = LANGS.find(x => x[0] === c); return l ? l[1] : c; }
  function noColon(s) { return s.replace(/[:：]\s*$/, ''); }
  let settingsBack = null;
  function openSettings(focusIdx, back) {
    if (back) settingsBack = back;
    show('settings');
    const box = $('settings-list');
    box.innerHTML = '';
    const again = k => () => openSettings(k);
    const audioName = Store.audio() ? langLabel(Store.audio()) : t('audio_auto');
    const subName = Store.subs() ? langLabel(Store.subs()) : t('off');
    const tr = [t('tr_none'), t('tr_light'), t('tr_medium'), t('tr_strong')];
    const buf = { small: t('buffer_small'), medium: t('buffer_medium'), large: t('buffer_large') };
    const secs = [3, 5, 8, 10, 15];
    const rows = [
      ['pl', t('add_playlist'), t('st_playlists_value', Store.playlists().length), () => openPlaylists(null, again('pl'))],
      ['epg', t('st_epg'), t('st_playlists_value', Store.playlists().length), () => epgSettings(again('epg'))],
      ['lang', t('st_language'), t('st_language_value', langLabel(LANG), audioName, subName), () => pick(t('st_language'), [
        { label: t('set_language', langLabel(LANG)) }, { label: t('set_audio', audioName) }, { label: t('set_subtitles', subName) }
      ], i => {
        if (i === 0) pick(t('choose_language'), LANGS.map(l => ({ label: l[1], on: l[0] === LANG })),
          j => { Store.saveLang(LANGS[j][0]); location.reload(); }, again('lang'));
        else if (i === 1) pick(noColon(t('set_audio', '')), [{ label: t('audio_auto'), on: !Store.audio() }, ...LANGS.map(l => ({ label: l[1], on: l[0] === Store.audio() }))],
          j => { Store.saveAudio(j ? LANGS[j - 1][0] : null); openSettings('lang'); }, again('lang'));
        else pick(t('choose_subtitles'), [{ label: t('subs_off'), on: !Store.subs() }, ...LANGS.map(l => ({ label: l[1], on: l[0] === Store.subs() }))],
          j => { Store.saveSubs(j ? LANGS[j - 1][0] : null); openSettings('lang'); }, again('lang'));
      }, again('lang'))],
      ['view', t('st_channel_view'), t(Store.view() === 'tiles' ? 'view_tiles' : 'view_rows'), () => { Store.saveView(Store.view() === 'tiles' ? 'rows' : 'tiles'); openSettings('view'); }],
      ['clock', t('st_clock'), clockValue(), () => chooseClock(again('clock'))],
      ['bar', t('st_overlay_time'), t('seconds_value', Store.barSec()), () => pick(t('st_overlay_time'), secs.map(s => ({ label: t('seconds_value', s), on: s === Store.barSec() })),
        j => { Store.saveBarSec(secs[j]); openSettings('bar'); }, again('bar'))],
      ['tr', t('st_transparency'), tr[Store.transp()] || tr[1], () => pick(t('st_transparency'), tr.map((x, i) => ({ label: x, on: i === Store.transp() })),
        j => { Store.saveTransp(j); applyLook(); openSettings('tr'); }, again('tr'))],
      ['buf', t('st_buffer'), buf[Store.buffer()], () => pick(t('choose_buffer'), Object.keys(buf).map(k => ({ label: buf[k], on: k === Store.buffer() })),
        j => { Store.saveBuffer(Object.keys(buf)[j]); applyLook(); openSettings('buf'); }, again('buf'))],
      // На Samsung громкость выравнивает сам телевизор (Звук → Автогромкость), поэтому строки там нет
      // На Samsung звук выводит сам телевизор — строка объясняет, где включить «Автогромкость»
      Player.native ? ['vol', t('st_volume_level'), t('legal_open'), () => doc(t('st_volume_level'), t('volume_tv_note'), again('vol'))]
        : ['vol', t('st_volume_level'), t(Store.leveler() ? 'on' : 'off'), () => { Store.saveLeveler(!Store.leveler()); applyLook(); openSettings('vol'); }],
      ['parental', t('st_parental'), t(Store.parental() ? 'on' : 'off'), () => chooseParental(again('parental'))],
      ['apppin', t('pin_button'), t(Store.appPin() ? 'pin_on' : 'pin_off'), () => appPinSettings(again('apppin'))],
      ['backup', t('set_backup'), t('st_backup_value'), () => pick(t('set_backup'), [{ label: t('backup_save') }, { label: t('backup_restore') }],
        i => (i === 0 ? saveBackup() : restoreBackup()), again('backup'))],
      ['log', t('log_title'), t('st_exo_log_value', Store.log().length), () => {
        const l = Store.log();
        doc(t('log_title'), l.length ? l.join('\n\n') : t('log_empty'), again('log'));
      }],
      ['privacy', t('legal_privacy'), t('legal_open'), () => doc(t('legal_privacy'), t('legal_privacy_text') + '\n\n' + t('legal_privacy_extra'), again('privacy'))],
      ['terms', t('legal_terms'), t('legal_open'), () => doc(t('legal_terms'), t('legal_terms_text') + '\n\n' + t('legal_terms_extra'), again('terms'))],
      ['lic', t('legal_licenses'), t('legal_open'), () => doc(t('legal_licenses'), t('legal_licenses_text') +
        '\n\n• hls.js — Apache License 2.0.\n• mpegts.js — Apache License 2.0.\n• pako — MIT License.', again('lic'))]
    ];
    if (typeof focusIdx === 'string') focusIdx = Math.max(0, rows.findIndex(r => r[0] === focusIdx));
    rows.forEach(([key, name, value, act]) => {
      const row = document.createElement('div');
      row.className = 'row-item focusable';
      row.tabIndex = 0;
      row.innerHTML = '<div class="ri-name"></div><div class="ri-sub"></div>';
      row.querySelector('.ri-name').textContent = noColon(name);
      row.querySelector('.ri-sub').textContent = value;
      row.onclick = act;
      box.appendChild(row);
    });
    $('settings-version').textContent = t('settings_version', VERSION);
    // «Назад» из настроек — туда, откуда пришли (каналы или плейлисты)
    Nav.setScope($('scr-settings'), () => (settingsBack || openPlaylists)());
    Nav.focus(box.children[focusIdx || 0]);
  }
  $('btn-settings').onclick = () => settingsGuard(() => openSettings(0, openPlaylists), () => openPlaylists());
  // При включённом «Скрыть 18+» настройки открываются только с PIN-кодом (как в Android)
  let settingsPassed = false;
  function settingsGuard(then, back) {
    if (!Store.parental() || settingsPassed) return then();
    checkPin(() => { settingsPassed = true; then(); }, back);
  }

  // ---------- Резервная копия (формат как в Android: плейлисты переносятся между приставкой и телевизором) ----------
  const WEB_PREFS = ['fav', 'audio', 'subs', 'view', 'barSec', 'transp', 'buffer'];
  async function saveBackup() {
    try {
      const web = {};
      const getters = { fav: Store.favorites, audio: Store.audio, subs: Store.subs, view: Store.view, barSec: Store.barSec, transp: Store.transp, buffer: Store.buffer };
      WEB_PREFS.forEach(k => { web[k] = getters[k](); });
      const data = {
        playlists: Store.playlists().map(p => ({ id: p.id, name: p.name, type: p.type, url: p.url || '', server: p.server || '',
          user: p.user || '', pass: p.pass || '', epg: p.epg || '', vod: false })),
        prefs: { lupo_web: web },
        language: LANG
      };
      const name = Backup.save(Backup.fileName(), await Backup.pack(data));
      toast(t('backup_saved', name));
    } catch (e) {
      toast(t('backup_failed'));
      Store.addLog(new Date().toLocaleString(LANG) + ' — backup\n' + (e && (e.message || e.name) || e));
    }
    openSettings('backup');
  }
  // Копия TiviMate, Televizo и похожих: плейлисты добавляются к своим, избранное — к новым плейлистам
  function foreignRestore(bytes) {
    const back = () => openSettings('backup');
    const f = Foreign.read(bytes);
    if (!f.playlists.length) { doc(t('set_backup'), t(f.encrypted ? 'foreign_encrypted' : 'foreign_nothing'), back); return; }
    const favCount = f.favByUrl.size ? [...f.favByUrl.values()].reduce((n, l) => n + l.length, 0) : f.favorites.length;
    $('pick').classList.add('center');
    pick(t('foreign_found_title') + '\n' + t('foreign_found', f.playlists.length, favCount), [{ label: t('foreign_add') }, { label: t('cancel') }], i => {
      if (i !== 0) return back();
      const all = Store.playlists();
      let fav = Store.favorites();
      f.playlists.forEach(p => {
        const src = p._src;
        delete p._src;
        all.push(p);
        const names = f.favByUrl.size ? (f.favByUrl.get(src) || []) : f.favorites;
        fav = fav.concat(names.map(n => p.id + '|' + n).filter(k => !fav.includes(k)));
      });
      Store.savePlaylists(all);
      Store.saveFavorites(fav);
      toast(t('backup_restored'));
      setTimeout(() => location.reload(), 1200);
    }, back);
  }
  async function restoreBackup() {
    let bytes = null;
    if (Backup.onTv) {
      const files = await Backup.find();
      if (!files.length) { doc(t('set_backup'), t('backup_not_found'), () => openSettings('backup')); return; }
      const idx = await new Promise(res => pick(t('backup_choose_file'), files.map(f => ({ label: f.replace(/^downloads\//, '') })), res, () => res(-1)));
      if (idx < 0) { openSettings('backup'); return; }
      try { bytes = Backup.read(files[idx]); } catch (e) { bytes = null; }
    } else bytes = await Backup.pickFile();
    if (!bytes || !bytes.length) { openSettings('backup'); return; }
    const text = new TextDecoder().decode(bytes);
    // Не своя копия — ищем в ней плейлисты и избранное другого плеера
    let own = false;
    try { own = !!JSON.parse(text.replace(/^[\ufeff\s]+/, '')).data; } catch (e) { }
    if (!own) return foreignRestore(bytes);
    if (!(await new Promise(res => ask(t('backup_replace_q'), t('backup_restore'), () => res(true), () => res(false))))) { openSettings('backup'); return; }
    try {
      const pass = Backup.needsPassword(text) ? prompt(t('backup_password')) || '' : '';
      const data = await Backup.unpack(text, pass);
      const list = (data.playlists || []).map(o => ({ id: String(o.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
        name: o.name || t('default_playlist_name'), type: o.type === 'xtream' ? 'xtream' : 'm3u',
        url: o.url || '', server: o.server || '', user: o.user || '', pass: o.pass || '', epg: o.epg || '' }));
      Store.savePlaylists(list);
      const web = data.prefs && data.prefs.lupo_web;
      if (web) {
        const setters = { fav: Store.saveFavorites, audio: Store.saveAudio, subs: Store.saveSubs, view: Store.saveView, barSec: Store.saveBarSec, transp: Store.saveTransp, buffer: Store.saveBuffer };
        WEB_PREFS.forEach(k => { if (k in web) setters[k](web[k]); });
      }
      const lang = (data.language || '').toLowerCase().split(/[-_,]/)[0].replace('iw', 'he');
      if (LANGS.some(l => l[0] === lang)) Store.saveLang(lang);
      Store.saveLast(null);
      toast(t('backup_restored'));
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      toast(t('backup_failed'));
      Store.addLog(new Date().toLocaleString(LANG) + ' — restore\n' + (e && (e.message || e.name) || e));
      openSettings('backup');
    }
  }

  // ---------- Каналы плейлиста ----------
  const ALL = '\u0001all', FAV = '\u0001fav', GFAV = '\u0001gfav';
  const GLOBAL = g => g === GFAV;
  let pl = null, channels = [], group = ALL, shown = [];

  function favKey(c) { return (c._pl || pl.id) + '|' + c.name; }
  // Идущий канал помним сам по себе: при смене папки его номер в списке пересчитывается,
  // и курсор возвращается именно на него (в сетке, в списке поверх видео, после настроек)
  let playingCh = null;
  function setShown(list) {
    shown = list;
    cur = playingCh ? shown.indexOf(playingCh) : -1;
    if (cur < 0 && playingCh) cur = shown.findIndex(c => c.name === playingCh.name && c.url === playingCh.url);
  }
  function isFav(c) { return Store.favorites().includes(favKey(c)); }
  // Родительский контроль: при «Скрыть 18+» каналы и папки для взрослых не показываются (как в Android)
  const ADULT = /18\+|\+18|xxx|adult|porn|erotic|eroti[ck]|playboy|brazzers|hustler|penthouse|dorcel|redlight|private\s?tv|эрот|порно|для взрослых|ночной клуб 18|eromania|extasy|o-la-la|ола-ла/i;
  function isAdultName(n) { return ADULT.test(n || ''); }
  function noAdult(list) { return Store.parental() ? (list || []).filter(c => !isAdultName(c.group) && !isAdultName(c.name)) : (list || []); }
  // Папка под PIN-кодом (ключ — плейлист и папка); PIN спрашивается один раз до выхода из программы
  function groupKey(g, pid) { return (pid || (pl ? pl.id : '')) + '|' + g; }
  function isGroupLocked(g, pid) { return g !== FAV && g !== ALL && g !== GFAV && Store.lockedGroups().includes(groupKey(g, pid)); }
  const unlockedGroups = new Set();
  function openLockedGroup(g, pid, then, back) {
    if (!isGroupLocked(g, pid) || unlockedGroups.has(groupKey(g, pid))) return then();
    checkPin(() => { unlockedGroups.add(groupKey(g, pid)); then(); }, back);
  }
  // Удерживать OK на папке — поставить или снять PIN-код
  function groupMenu(g, pid, back) {
    if (g === FAV || g === ALL || g === GFAV) return back();
    const k = groupKey(g, pid);
    const on = isGroupLocked(g, pid);
    pick(groupLabel(g), [{ label: t(on ? 'unlock_group' : 'lock_group') }], () => {
      if (on) checkPin(() => { Store.saveLockedGroups(Store.lockedGroups().filter(x => x !== k)); toast(t('group_unlocked')); back(); }, back);
      else ensurePin(() => { Store.saveLockedGroups([...Store.lockedGroups(), k]); toast(t('group_locked_on')); back(); }, back);
    }, back);
  }
  function groupsOf(list) {
    const g = [];
    list.forEach(c => { if (!g.includes(c.group)) g.push(c.group); });
    return [FAV, ALL, ...g];
  }
  function groupLabel(g) { return g === ALL ? t('group_all') : g === FAV ? t('group_fav') : g === GFAV ? t('group_fav') + ' · ' + t('all_playlists') : g; }
  // Общее избранное всех плейлистов: каналы берутся из сохранённых списков каждого плейлиста
  let gfavCache = null;
  function allFavorites() {
    const f = Store.favorites();
    const out = [];
    Store.playlists().filter(p => !p.off).forEach(p => {
      const d = p.id === (pl && pl.id) ? { channels } : Store.channels(p.id);
      noAdult(d && d.channels).forEach(c => { if (f.includes(p.id + '|' + c.name)) out.push(p.id === (pl && pl.id) ? c : Object.assign({ _pl: p.id }, c)); });
    });
    return out;
  }
  function inGroup(g) {
    if (g === GFAV) return gfavCache = allFavorites();
    if (g === ALL) return channels;
    // Избранное — в своём порядке (его можно менять: «Переместить»)
    if (g === FAV) { const f = Store.favorites(); return f.map(k => channels.find(c => favKey(c) === k)).filter(Boolean); }
    return channels.filter(c => c.group === g);
  }
  function logoEl(c) {
    const box = document.createElement('div');
    box.className = 'ch-logo';
    if (c.logo) {
      const img = document.createElement('img');
      img.src = c.logo;
      img.onerror = () => { img.remove(); box.textContent = (c.name || '?').slice(0, 1); };
      box.appendChild(img);
    } else box.textContent = (c.name || '?').slice(0, 1);
    return box;
  }
  function dispName(c) { return (c && Store.renames()[favKey(c)]) || (c ? c.name : ''); }
  function chName(c) { return (isFav(c) ? '★ ' : '') + (isLocked(c) ? '🔒 ' : '') + dispName(c); }
  function groupName(g, pid) { return (isGroupLocked(g, pid) ? '🔒 ' : '') + groupLabel(g); }
  function isLocked(c) { return Store.locked().includes(favKey(c)); }

  // Строка канала (список поверх видео): номер, логотип, название, текущая передача с полоской
  function channelRow(c, i) {
    const el = document.createElement('div');
    el.className = 'ch focusable';
    el.tabIndex = 0;
    const num = document.createElement('div');
    num.className = 'ch-num';
    num.textContent = i + 1;
    const name = document.createElement('div');
    name.className = 'ch-name';
    name.textContent = chName(c);
    const text = document.createElement('div');
    text.className = 'ch-text';
    const prog = document.createElement('div');
    prog.className = 'ch-prog';
    text.append(name, prog);
    fillProg(prog, c);
    el.append(num, logoEl(c), text);
    return el;
  }
  function fillProg(box, c) {
    const n = Epg.now(c);
    box.innerHTML = '';
    if (!n) return;
    const s = document.createElement('span');
    s.textContent = n.cur.t;
    const bar = document.createElement('i');
    bar.style.width = Math.round(100 * (Date.now() - n.cur.s) / (n.cur.e - n.cur.s)) + '%';
    const line = document.createElement('b');
    line.appendChild(bar);
    box.append(s, line);
  }
  function refreshProgs() {
    [...$('side-list').children].forEach((el, i) => { const p = el.querySelector('.ch-prog'); if (p && sideShown[i]) fillProg(p, sideShown[i]); });
    if (!$('bar').classList.contains('hidden') && cur >= 0) fillBar();
    if (!$('guide').classList.contains('hidden')) renderGuide();
  }
  Epg.onChange(refreshProgs);
  setInterval(refreshProgs, 60000);

  // Плейлист: сохранённые каналы сразу, свежие — в фоне
  async function loadPlaylist(p, data) {
    pl = p;
    data = data || Store.channels(p.id);
    if (data) setChannels(data);
    else { channels = []; shown = []; }
    try {
      const fresh = await M3U.load(p, t('no_group'), n => t('channel_n', n));
      Store.saveChannels(p.id, fresh);
      if (pl !== p) return;
      if (!data) { setChannels(fresh); if (!$('guide').classList.contains('hidden')) { gi = 0; renderGuide(); if (cur < 0 || !Player.isPlaying()) previewInGuide(0); } }
      else { channels = noAdult(fresh.channels); setShown(inGroup(group)); Epg.open(pl.id, fresh.epg || [], channels); }
    } catch (e) {
      if (!data && pl === p) toast(t('load_error') + ' ' + errorText(e));
    }
  }
  function setChannels(data) {
    channels = noAdult(data.channels);
    Epg.open(pl.id, data.epg || [], channels);
    const last = Store.last();
    group = last && last.pl === pl.id && groupsOf(channels).includes(last.group) ? last.group : ALL;
    if (group === FAV && !inGroup(FAV).length) group = ALL;
    setShown(inGroup(group));
  }

  // ---------- Телепрограмма сеткой ----------
  const VIDEO_RECT = { x: 40, y: 30, w: 720, h: 405 };
  const ROWS = 7, WIN_MIN = 150, HALF = 30 * 60000;
  let gi = 0, gt = Date.now(), winStart = 0;
  function floorHalf(ms) { return Math.floor(ms / HALF) * HALF; }

  // autoplay — при старте программы сразу включить последний канал на весь экран
  function openGuide(p, data, autoplay) {
    if (!p) return openPlaylists();
    show('player');
    const fresh = !pl || pl.id !== p.id || data || !channels.length;
    if (fresh) loadPlaylist(p, data);
    if (fresh && pl && pl.id !== p.id) { Player.stop(); cur = -1; }
    const last = Store.last();
    const lastIdx = last && last.pl === p.id ? shown.findIndex(c => c.name === last.name) : -1;
    if (autoplay && lastIdx >= 0) { play(lastIdx); return; }
    if (playingCh && cur < 0) {   // идущий канал из другой папки — открываем его папку
      const g = groupsOf(channels).find(x => x !== FAV && x !== ALL && x === playingCh.group);
      if (g && !GLOBAL(group)) { group = g; setShown(inGroup(g)); }
    }
    gi = cur >= 0 ? cur : Math.max(0, lastIdx);
    gt = Date.now();
    winStart = floorHalf(Date.now()) - HALF;
    closeSide();
    $('bar').classList.add('hidden');
    $('guide').classList.remove('hidden');
    Radio.visible(false);
    $('drawer').classList.add('hidden');
    Player.setRect(VIDEO_RECT);
    renderGuide();
    guideScope();
    // Ничего не играет (первый запуск, переустановка) — канал под курсором сразу идёт в окне видео
    if ((cur < 0 || !Player.isPlaying()) && shown.length) previewInGuide(gi);
  }
  function closeGuide() {
    Radio.visible(true);
    $('guide').classList.add('hidden');
    $('drawer').classList.add('hidden');
    Player.setRect(null);
  }
  function guideScope() {
    if (Store.view() === 'tiles') Nav.setScope($('g-tiles'), guideBack, tileKeys);
    else Nav.setScope($('guide'), guideBack, guideKeys);
  }
  // «Назад» в телепрограмме — папки и плейлисты; ещё «Назад» — меню; в меню «Назад» — вопрос о выходе (как в Android).
  // К каналу на весь экран — OK на канале
  function guideBack() { openDrawer(); }

  function renderGuide() {
    const tiles = Store.view() === 'tiles';
    $('guide').classList.toggle('tiles', tiles);
    $('guide').classList.toggle('playing', cur >= 0 && Player.isPlaying());
    $('g-group').textContent = (pl ? pl.name + ' · ' : '') + groupLabel(group);
    if (tiles) return renderTiles();
    const rows = $('g-rows');
    rows.innerHTML = '';
    const line = $('g-times');
    line.innerHTML = '';
    if (!shown.length) { rows.textContent = t('panel_empty'); fillInfo(null, null); return; }
    gi = Math.max(0, Math.min(gi, shown.length - 1));
    const width = rows.clientWidth - 360;
    const px = width / WIN_MIN;
    for (let m = 0; m <= WIN_MIN; m += 30) {
      const s = document.createElement('span');
      s.style.left = (m * px) + 'px';
      s.textContent = hm(winStart + m * 60000);
      if (m < WIN_MIN) line.appendChild(s);
    }
    const winEnd = winStart + WIN_MIN * 60000;
    const top = Math.max(0, Math.min(gi - 3, shown.length - ROWS));
    let focused = null;
    for (let r = top; r < Math.min(shown.length, top + ROWS); r++) {
      const c = shown[r];
      const row = document.createElement('div');
      row.className = 'g-row' + (r === cur ? ' cur' : '');
      const ch = document.createElement('div');
      ch.className = 'g-ch';
      const num = document.createElement('div');
      num.className = 'ch-num';
      num.textContent = r + 1;
      const name = document.createElement('div');
      name.className = 'ch-name';
      name.textContent = chName(c);
      ch.append(num, logoEl(c), name);
      const lineEl = document.createElement('div');
      lineEl.className = 'g-line';
      const progs = Epg.list(c).filter(p => p.e > winStart && p.s < winEnd);
      if (!progs.length) {
        const cell = document.createElement('div');
        cell.className = 'g-p';
        cell.style.left = '0'; cell.style.width = '100%';
        cell.innerHTML = '<b></b>';
        cell.firstChild.textContent = t('no_epg');
        if (r === gi) { cell.classList.add('focus'); focused = { c, p: null }; }
        lineEl.appendChild(cell);
      }
      progs.forEach(p => {
        const cell = document.createElement('div');
        cell.className = 'g-p' + (p.s <= Date.now() && p.e > Date.now() ? ' live' : '');
        const l = Math.max(0, (p.s - winStart) / 60000 * px);
        const rr = Math.min(width, (p.e - winStart) / 60000 * px);
        cell.style.left = l + 'px';
        cell.style.width = Math.max(4, rr - l) + 'px';
        cell.innerHTML = '<b></b><span></span>';
        cell.firstChild.textContent = p.t;
        cell.lastChild.textContent = hm(p.s) + '–' + hm(p.e);
        if (r === gi && p.s <= gt && p.e > gt) { cell.classList.add('focus'); focused = { c, p }; }
        lineEl.appendChild(cell);
      });
      if (r === gi && !focused && progs.length) {
        const first = lineEl.querySelector('.g-p');
        first.classList.add('focus');
        focused = { c, p: progs[0] };
        gt = Math.max(progs[0].s, winStart);
      }
      if (Date.now() > winStart && Date.now() < winEnd) {
        const now = document.createElement('div');
        now.className = 'g-now';
        now.style.left = ((Date.now() - winStart) / 60000 * px) + 'px';
        lineEl.appendChild(now);
      }
      row.append(ch, lineEl);
      rows.appendChild(row);
    }
    fillInfo(focused && focused.c, focused && focused.p);
  }
  function fillInfo(c, p) {
    $('g-chan').textContent = c ? (shown.indexOf(c) + 1) + '  ' + dispName(c) : '';
    $('g-title').textContent = p ? p.t : (c ? t('no_epg') : '');
    $('g-time').textContent = p ? hm(p.s) + '–' + hm(p.e) + '   ' + new Date(p.s).toLocaleDateString(LANG, { weekday: 'long', day: 'numeric', month: 'long' }) : '';
    $('g-desc').textContent = p ? (p.d || t('info_no_desc')) : '';
  }
  function focusedProg() {
    const c = shown[gi];
    return c ? Epg.list(c).find(p => p.s <= gt && p.e > gt) : null;
  }
  // Сетка: ▲▼ — каналы, ◀▶ — передачи по времени, ◀ в начале — папки и плейлисты, OK — смотреть канал
  function guideKeys(e) {
    const k = e.keyCode;
    if (digitKey(e)) return true;
    // OK — смотреть, удерживать OK — меню канала
    if (k === 13) return holdOk(e, () => playFromGuide(gi), () => shown[gi] && chMenu(shown[gi], () => { guideScope(); renderGuide(); }));
    if (k === 38 || k === 40) { if (shown.length) gi = (gi + (k === 40 ? 1 : -1) + shown.length) % shown.length; renderGuide(); return true; }
    if (k === 427 || k === 428 || k === 33 || k === 34) { gi = Math.max(0, Math.min(shown.length - 1, gi + ((k === 428 || k === 34) ? ROWS : -ROWS))); renderGuide(); return true; }
    if (k === 39) {
      const p = focusedProg();
      if (!p) return true;
      gt = p.e + 1;
      while (gt >= winStart + (WIN_MIN - 30) * 60000) winStart += HALF;
      renderGuide();
      return true;
    }
    if (k === 37) {
      const p = focusedProg();
      const floor = Catchup.has(shown[gi]) ? floorHalf(Date.now() - Catchup.days(shown[gi]) * 86400e3) : floorHalf(Date.now()) - HALF;
      if (!p || p.s <= winStart) {
        if (winStart > floor) { winStart -= HALF; gt = Math.max(winStart, (p ? p.s : gt) - 1); renderGuide(); }
        else openDrawer();
        return true;
      }
      gt = p.s - 1;
      renderGuide();
      return true;
    }
    if (k === 70 || k === 404 || k === 405) { toggleFav(shown[gi]); renderGuide(); return true; }
    if (GUIDE_KEYS.includes(k) && shown[gi]) { openSchedule(shown[gi], guideScope); return true; }
    return false;
  }
  function previewInGuide(i) {
    const c = shown[i];
    if (!c) return;
    if (i !== cur) prev = cur;
    cur = i;
    playingCh = c;
    arch = null;
    if (Radio.looks(c)) { Radio.show(c, dispName(c)); Radio.visible(false); } else Radio.hide();
    Player.start(c.url);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (shown[cur] === c && !Player.isPlaying()) Player.start(c.url); }, 7000);
    Store.saveLast({ pl: pl.id, group, name: c.name });
  }
  function playFromGuide(i) {
    const p = focusedProg();
    if (p && p.e <= Date.now()) { playArchive(i, p); return; }
    if (p && p.s > Date.now()) return;   // будущая передача — пока только описание
    if (i === cur && Player.isPlaying() && !arch) { closeGuide(); playerScope(); showBar(); return; }
    closeGuide();
    play(i);
  }

  // Плитка поверх идущего видео: OK — смотреть; ◀ в первом столбце — папки и плейлисты
  function renderTiles() {
    const box = $('g-tiles');
    box.innerHTML = '';
    $('g-tiles').classList.remove('hidden');
    shown.forEach((c, i) => {
      const el = document.createElement('div');
      el.className = 'tile focusable';
      el.tabIndex = 0;
      const num = document.createElement('div');
      num.className = 'tile-num';
      num.textContent = i + 1;
      const name = document.createElement('div');
      name.className = 'tile-name';
      name.textContent = chName(c);
      el.append(num, logoEl(c), name);
      el.onclick = () => playFromGuide(i);
      el.addEventListener('focus', () => { gi = i; const n = Epg.now(c); fillInfo(c, n && n.cur); });
      box.appendChild(el);
    });
    if (!shown.length) box.textContent = t('panel_empty');
    Nav.focus(box.children[Math.max(0, Math.min(gi, shown.length - 1))]);
  }
  function tileKeys(e) {
    const el = document.activeElement;
    const idx = el ? [...$('g-tiles').children].indexOf(el) : -1;
    if (digitKey(e)) return true;
    if (e.keyCode === 13 && idx >= 0) return holdOk(e, () => playFromGuide(idx), () => chMenu(shown[idx], () => { guideScope(); renderTiles(); }));
    if (e.keyCode === 37 && idx % 5 === 0) { gi = idx; openDrawer(); return true; }
    if ((e.keyCode === 70 || e.keyCode === 404 || e.keyCode === 405) && idx >= 0) {
      toggleFav(shown[idx]); el.querySelector('.tile-name').textContent = chName(shown[idx]); return true;
    }
    if (GUIDE_KEYS.includes(e.keyCode) && idx >= 0) { gi = idx; openSchedule(shown[idx], () => { guideScope(); renderTiles(); }); return true; }
    return false;
  }

  // ---------- Слева: папки и плейлисты; ещё левее — меню ----------
  function openDrawer() {
    const box = $('dr-groups');
    box.innerHTML = '';
    const head = txt => { const h = document.createElement('div'); h.className = 'dr-head'; h.textContent = txt; box.appendChild(h); };
    const item = (label, on, act, g, pid) => {
      const el = document.createElement('div');
      el.className = 'grp focusable' + (on ? ' on' : '');
      el.tabIndex = 0;
      el.textContent = label;
      el.onclick = act;
      el._g = g; el._pid = pid;
      box.appendChild(el);
    };
    // В самом верху — общее избранное всех плейлистов; дальше плейлисты по порядку, у каждого свои папки
    // (своё «Избранное», «Все каналы», папки)
    item('★ ' + t('group_fav').replace(/^★\s*/, '') + ' · ' + t('all_playlists'), group === GFAV, () => { group = GFAV; setShown(inGroup(GFAV)); gi = Math.max(0, cur); closeDrawer(); renderGuide(); });
    Store.playlists().filter(p => !p.off).forEach(p => {
      head(p.name);
      const mine = pl && p.id === pl.id;
      const list = mine ? channels : ((Store.channels(p.id) || {}).channels || []);
      const gs = [];
      noAdult(list).forEach(c => { if (!gs.includes(c.group)) gs.push(c.group); });
      [FAV, ALL, ...gs.filter(g => list.some(c => c.group === g) && (!Store.parental() || !isAdultName(g)))].forEach(g => item(groupName(g, p.id), mine && g === group, () => openLockedGroup(g, p.id, () => {
        closeDrawer();
        if (mine) { group = g; setShown(inGroup(g)); gi = Math.max(0, cur); renderGuide(); return; }
        Player.stop(); cur = -1; playingCh = null;
        Store.saveLast({ pl: p.id, group: g, name: '' });
        openGuide(p);
      }, () => { Nav.setScope($('drawer'), drawerBack, drawerKeys); openDrawer(); }), g, p.id));
    });
    const menu = $('dr-menu');
    menu.innerHTML = '';
    // Меню как в Android: Поиск, Фильмы, Сериалы, Обновить, Тест скорости, Настройки («Мои плейлисты» — в Настройках)
    [['🔍  ' + t('search_title'), () => { closeDrawer(); openSearch(); }],
     ['🎬  ' + t('vod_movies'), () => openVod('movie')],
     ['📺  ' + t('vod_series'), () => openVod('series')],
     ['⟳  ' + t('refresh'), () => { closeDrawer(); refreshAll(); }],
     ['⏱  ' + t('speed_test'), () => { closeDrawer(); speedTest(); }],
     [t('settings'), () => settingsGuard(() => { closeDrawer(); closeGuide(); openSettings(0, () => openGuide(pl)); }, () => openDrawer())]].forEach(([label, act]) => {
      const el = document.createElement('div');
      el.className = 'grp focusable';
      el.tabIndex = 0;
      el.textContent = label;
      el.onclick = act;
      menu.appendChild(el);
    });
    menu.classList.add('hidden');
    $('guide').classList.remove('with-menu'); shiftVideo();
    $('drawer').classList.remove('hidden');
    $('guide').classList.add('with-drawer'); shiftVideo();
    Nav.setScope($('drawer'), drawerBack, drawerKeys);
    Nav.focus(box.querySelector('.grp.on') || box.querySelector('.grp'));
  }
  function drawerKeys(e) {
    const el = document.activeElement;
    // Курсор по кругу: с последней строки вниз — на первую, с первой вверх — на последнюю
    if ((e.keyCode === 38 || e.keyCode === 40) && el && el.classList.contains('grp') && !el.closest('#dr-menu')) {
      const list = [...el.parentNode.querySelectorAll('.grp')];
      const i = list.indexOf(el);
      if (e.keyCode === 40 && i === list.length - 1) { Nav.focus(list[0]); return true; }
      if (e.keyCode === 38 && i === 0) { Nav.focus(list[list.length - 1]); return true; }
    }
    const inMenu = el && el.closest('#dr-menu');
    // Удерживать OK на папке — PIN-код на папку
    if (e.keyCode === 13 && el && el._g !== undefined && el.closest('#dr-groups')) {
      return holdOk(e, () => el.click(), () => groupMenu(el._g, el._pid, () => { openDrawer(); }));
    }
    if (e.keyCode === 37 && !inMenu) { $('dr-menu').classList.remove('hidden'); $('guide').classList.add('with-menu'); shiftVideo(); Nav.focus($('dr-menu').firstChild); return true; }
    if (e.keyCode === 39 && inMenu) { $('dr-menu').classList.add('hidden'); $('guide').classList.remove('with-menu'); shiftVideo(); Nav.focus($('dr-groups').querySelector('.grp.on') || $('dr-groups').querySelector('.grp')); return true; }
    if (e.keyCode === 39 && !inMenu) { closeDrawer(); return true; }
    return false;
  }
  // Окно видео сдвигается вместе с сеткой (родной плеер Samsung рисует видео сам — ему нужен новый прямоугольник)
  function shiftVideo() {
    const g = $('guide');
    const dx = !g.classList.contains('with-drawer') ? 0 : g.classList.contains('with-menu') ? 860 : 440;
    if (true) Player.setRect({ x: VIDEO_RECT.x + dx, y: VIDEO_RECT.y, w: VIDEO_RECT.w, h: VIDEO_RECT.h });
    setTimeout(renderGuide, 220);
  }
  function drawerBack() {
    const el = document.activeElement;
    if (el && el.closest('#dr-menu')) { askExit(); return; }
    $('dr-menu').classList.remove('hidden');
    $('guide').classList.add('with-menu'); shiftVideo();
    Nav.focus($('dr-menu').firstChild);
  }
  function closeDrawer() {
    $('drawer').classList.add('hidden');
    $('guide').classList.remove('with-drawer'); $('guide').classList.remove('with-menu'); shiftVideo(); shiftVideo();
    if (!$('guide').classList.contains('hidden')) { guideScope(); if (Store.view() === 'tiles') renderTiles(); }
  }

  // «Обновить»: заново скачать плейлист и программу передач
  async function refreshAll() {
    if (!pl) return;
    toast(t('refreshing'));
    try {
      const fresh = await M3U.load(pl, t('no_group'), n => t('channel_n', n));
      Store.saveChannels(pl.id, fresh);
      channels = noAdult(fresh.channels);
      setShown(inGroup(group));
      Epg.open(pl.id, fresh.epg || [], channels, true);
      toast(t('refreshed'));
    } catch (e) { toast(t('refresh_failed', errorText(e))); }
    renderGuide();
    guideScope();
  }

  // Поиск канала по названию во всём плейлисте
  function openSearch() {
    $('search-title').textContent = t('search_title');
    const input = $('search-input');
    input.placeholder = t('search_hint');
    input.value = '';
    $('search-list').innerHTML = '';
    $('search').classList.remove('hidden');
    const close = () => { $('search').classList.add('hidden'); guideScope(); if (Store.view() === 'tiles') renderTiles(); };
    Nav.setScope($('search'), close);
    Nav.focus($('search').querySelector('.fbox'));
  }
  $('search-input').addEventListener('input', () => {
    const q = $('search-input').value.trim().toLowerCase();
    const box = $('search-list');
    box.innerHTML = '';
    if (!q) return;
    channels.filter(c => c.name.toLowerCase().includes(q)).slice(0, 80).forEach(c => {
      const i = channels.indexOf(c);
      const el = channelRow(c, i);
      el.onclick = () => { $('search').classList.add('hidden'); group = ALL; setShown(channels); prev = -1; play(i); };
      box.appendChild(el);
    });
  });

  // Тест скорости интернета: пинг и скачивание тестового файла (как в Android — сервер Cloudflare).
  // Через XMLHttpRequest: на телевизорах он надёжнее, чем fetch с чтением по частям
  function xhr(url, onProgress, timeout) {
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest();
      x.open('GET', url + (url.includes('?') ? '&' : '?') + 'r=' + Math.random());
      x.responseType = 'arraybuffer';
      x.timeout = timeout || 60000;
      if (onProgress) x.onprogress = e => onProgress(e.loaded);
      x.onload = () => x.status >= 200 && x.status < 400 ? res(x.response ? x.response.byteLength : 0) : rej(new Error('HTTP ' + x.status));
      x.onerror = () => rej(new Error('network'));
      x.ontimeout = () => rej(new Error('timeout'));
      x.send();
    });
  }
  // Серверы провайдера — разные адреса каналов плейлиста (до 4), у открытых чужих каналов — одна строка
  function providerHosts() {
    const hosts = [];
    channels.forEach(c => { try { const h = new URL(c.url).host; if (!hosts.includes(h)) hosts.push(h); } catch (e) { } });
    return hosts.length > 8 ? hosts.slice(0, 1) : hosts.slice(0, 4);
  }
  function gauge(mbps) {
    const max = mbps > 1000 ? 2500 : mbps > 500 ? 1000 : 500;
    $('sp-num').textContent = Math.round(mbps);
    $('sp-arc').style.strokeDashoffset = 252 * (1 - Math.min(1, mbps / max));
  }
  async function speedTest() {
    const back = Nav.state();
    $('speed').classList.remove('hidden');
    $('sp-ping-l').textContent = t('speed_ping', '').replace(/[\d\s]*мс|ms/i, '').trim() || 'ping';
    $('sp-jit-l').textContent = t('speed_jitter', '').replace(/[\d\s]*мс|ms/i, '').trim() || 'jitter';
    $('sp-status').textContent = t('speed_hint');
    gauge(0);
    const box = $('sp-servers');
    box.innerHTML = '';
    const hosts = providerHosts();
    if (!hosts.length) box.textContent = t('speed_no_servers');
    hosts.forEach(h => {
      const row = document.createElement('div');
      row.className = 'sp-row';
      row.innerHTML = '<div></div><div class="h"></div><div class="h"></div>';
      row.firstChild.textContent = h;
      row.children[1].textContent = t('speed_wait');
      box.appendChild(row);
    });
    const close = () => { $('speed').classList.add('hidden'); back(); };
    Nav.setScope($('speed'), close);
    Nav.focus($('sp-btn'));
    $('sp-btn').onclick = async () => {
      $('sp-btn').disabled = true;
      try {
        $('sp-status').textContent = t('speed_measuring', 'Cloudflare');
        const pings = [];
        for (let i = 0; i < 6; i++) { const t0 = performance.now(); await xhr('https://speed.cloudflare.com/__down?bytes=0'); pings.push(performance.now() - t0); }
        const avg = pings.reduce((a, b) => a + b, 0) / pings.length;
        const jit = pings.slice(1).reduce((a, p, i) => a + Math.abs(p - pings[i]), 0) / (pings.length - 1);
        $('sp-ping').textContent = Math.round(Math.min(...pings)) + ' ms';
        $('sp-jit').textContent = Math.round(jit) + ' ms';
        $('sp-status').textContent = t('speed_heavy');
        const t0 = performance.now();
        let total = 0, mb = 0;
        const rate = n => (total + n) * 8 / ((performance.now() - t0) / 1000) / 1e6;
        // Части по 10 МБ подряд, пока не пройдёт 10 секунд (или 20 частей)
        for (let part = 0; part < 20 && performance.now() - t0 < 10000; part++) {
          const got = await xhr('https://speed.cloudflare.com/__down?bytes=10000000', n => gauge(rate(n)), 20000);
          total += got;
          mb = rate(0);
          gauge(mb);
        }
        $('sp-hd').textContent = mb >= 25 ? '✓ 4K' : mb >= 8 ? '✓ HD' : '✗';
        // Серверы провайдера: время ответа каждого
        for (let i = 0; i < hosts.length; i++) {
          const row = box.children[i];
          $('sp-status').textContent = t('speed_measuring', hosts[i]);
          const times = [];
          for (let j = 0; j < 3; j++) {
            const s0 = performance.now();
            try { await xhr('http://' + hosts[i] + '/', null, 8000); } catch (e) { }
            times.push(performance.now() - s0);
          }
          times.sort((a, b) => a - b);
          row.children[1].textContent = times[0] > 9000 ? t('speed_failed') : t('speed_ping', Math.round(times[0]));
          row.children[2].textContent = t('speed_jitter', Math.round(times[2] - times[0]));
        }
        $('sp-status').textContent = t('speed_done');
      } catch (e) {
        $('sp-status').textContent = t('err_generic', e && e.message || '');
        Store.addLog(new Date().toLocaleString(LANG) + ' — speed test\n' + (e && e.message || e));
      }
      $('sp-btn').disabled = false;
      $('sp-btn').textContent = t('speed_again');
      Nav.focus($('sp-btn'));
    };
  }

  // ---------- Ввод текста / PIN-кода ----------
  function inputDialog(title, value, password, onOk, onCancel) {
    $('input-title').textContent = title;
    const f = $('input-field');
    f.type = password ? 'password' : 'text';
    f.inputMode = password ? 'numeric' : 'text';
    f.value = value || '';
    $('input-error').textContent = '';
    $('input').classList.remove('hidden');
    const close = () => $('input').classList.add('hidden');
    $('input-ok').onclick = () => { const v = f.value.trim(); if (onOk(v, msg => { $('input-error').textContent = msg; }) !== false) close(); };
    $('input-cancel').onclick = () => { close(); if (onCancel) onCancel(); };
    Nav.setScope($('input'), () => { close(); if (onCancel) onCancel(); });
    Nav.focus($('input').querySelector('.fbox'));
  }
  // PIN нет — сначала задать (от 4 цифр); есть — спросить
  function ensurePin(then, back) {
    if (Store.pin()) return then();
    inputDialog(t('pin_new'), '', true, (v, err) => {
      if (!/^\d{4,}$/.test(v)) { err(t('pin_new')); return false; }
      Store.savePin(v);
      setTimeout(then, 0);
    }, back);
  }
  function checkPin(then, back) {
    if (!Store.pin()) return then();
    inputDialog(t('pin_enter'), '', true, (v, err) => {
      if (v !== Store.pin()) { err(t('pin_wrong')); return false; }
      setTimeout(then, 0);
    }, back);
  }

  // ---------- Меню канала (удерживать OK на канале): избранное, переместить, переименовать, PIN ----------
  function chMenu(c, back, opts) {
    const items = [
      { label: t(isFav(c) ? 'info_fav_remove' : 'info_fav_add'), act: () => { toggleFav(c); back(); } }
    ];
    if (opts && opts.move && group === FAV && isFav(c)) items.push({ label: t('move'), act: () => opts.move() });
    items.push({ label: t('rename_channel'), act: () => inputDialog(t('rename_title'), dispName(c), false, v => {
      const m = Store.renames();
      if (!v || v === c.name) delete m[favKey(c)]; else m[favKey(c)] = v;
      Store.saveRenames(m);
      setTimeout(back, 0);
    }, back) });
    items.push(isLocked(c)
      ? { label: t('unlock_channel'), act: () => checkPin(() => { Store.saveLocked(Store.locked().filter(k => k !== favKey(c))); toast(t('channel_unlocked')); back(); }, back) }
      : { label: t('lock_channel'), act: () => ensurePin(() => { Store.saveLocked([...Store.locked(), favKey(c)]); toast(t('channel_locked_on')); back(); }, back) });
    pick(dispName(c), items.map(i => ({ label: i.label })), i => items[i].act(), back);
  }
  // Удержание OK: коротко — обычное действие, держать — меню
  let okHold = null;
  function holdOk(e, onShort, onLong) {
    if (e.keyCode !== 13) return false;
    if (!okHold) okHold = { short: onShort, fired: false, timer: setTimeout(() => { if (okHold) { okHold.fired = true; onLong(); } }, 600) };
    return true;
  }
  document.addEventListener('keyup', e => {
    if (e.keyCode !== 13 || !okHold) return;
    clearTimeout(okHold.timer);
    const h = okHold;
    okHold = null;
    if (!h.fired) h.short();
  });

  // ---------- Номер канала цифрами пульта ----------
  let digitBuf = '', digitTimer = null;
  function digitKey(e) {
    const k = e.keyCode;
    const d = k >= 48 && k <= 57 ? k - 48 : k >= 96 && k <= 105 ? k - 96 : -1;
    if (d < 0) return false;
    digitBuf = (digitBuf + d).slice(-4);
    $('digits').textContent = digitBuf;
    $('digits').classList.remove('hidden');
    clearTimeout(digitTimer);
    digitTimer = setTimeout(() => {
      const n = parseInt(digitBuf, 10);
      digitBuf = '';
      $('digits').classList.add('hidden');
      if (n >= 1 && n <= shown.length) { closeGuide(); closeSide(); play(n - 1); }
    }, 1500);
    return true;
  }

  // О передаче (второе OK на видео): название, время, описание, дальше по программе
  function openInfo(c) {
    const n = Epg.now(c);
    const box = $('sched-list');
    box.innerHTML = '';
    $('sched-title').textContent = dispName(c);
    if (!n) box.textContent = t('no_epg_channel');
    else [n.cur, ...Epg.list(c).filter(p => p.s >= n.cur.e).slice(0, 6)].forEach((p, i) => {
      const el = document.createElement('div');
      el.className = 'sched-item focusable' + (i === 0 ? ' live' : '');
      el.tabIndex = 0;
      el.innerHTML = '<div class="si-time"></div><div class="si-title"></div><div class="si-desc"></div>';
      el.querySelector('.si-time').textContent = hm(p.s);
      el.querySelector('.si-title').textContent = p.t;
      const d = el.querySelector('.si-desc');
      if (i === 0) d.textContent = p.d || t('info_no_desc'); else d.classList.add('hidden');
      el.onclick = () => { d.textContent = p.d || t('info_no_desc'); d.classList.toggle('hidden'); };
      box.appendChild(el);
    });
    $('sched').classList.remove('hidden');
    Nav.setScope($('sched'), () => { $('sched').classList.add('hidden'); playerScope(); });
    Nav.focus(box.querySelector('.focusable'));
  }
  // Меню на видео (удерживать OK): смотреть рядом, звук, субтитры, программа
  function playerMenu() {
    const c = shown[cur];
    const items = [
      { label: t('split_watch'), act: () => Player.canSplit ? splitPick() : doc(t('split_watch'), t('split_soon'), playerScope) },
      { label: t('audio_track'), act: openAudioMenu },
      { label: t('choose_subtitles'), act: openSubsMenu },
      { label: t('schedule_title'), act: () => c && openSchedule(c, playerScope) },
      { label: t('size_title'), act: () => sizeMenu(playerScope) }
    ];
    pick(dispName(c), items.map(i => ({ label: i.label })), i => items[i].act(), playerScope);
  }

  // ---------- Фильмы и сериалы (Xtream Codes), как в Android (Vod.kt, VodActivity.kt) ----------
  let vodPl = null, vodKind = 'movie', vodList = null, vodCat = null, vodQuery = '', vodItems = [], vodShownN = 0;
  let vodCache = null;   // последний загруженный раздел {key, at, list}
  let vod = null;        // что сейчас играет: {urls, titles, idx, item, epIds, back}
  const VOD_PAGE = 60;
  function vodApi(p) { return M3U.normalizeServer(p.server) + '/player_api.php?username=' + encodeURIComponent(p.user) + '&password=' + encodeURIComponent(p.pass); }
  async function vodGet(url) {
    let r;
    try { r = await fetch(url, { cache: 'no-store' }); } catch (e) { throw new Error(t('err_no_connection')); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  function vodYear(o) {
    const m = /(19|20)\d\d/.exec(o.releaseDate || o.release_date || o.year || '') || /\(((19|20)\d\d)\)/.exec(o.name || '');
    return m ? (m[1] && m[1].length === 4 ? m[1] : m[0]) : '';
  }
  function vodRating(o) { const r = parseFloat(String(o.rating || '').replace(',', '.')); return r > 0 ? r.toFixed(1) : ''; }
  // Раздел «Фильмы» или «Сериалы»: плейлист Xtream — текущий, иначе первый включённый; несколько — спросить
  function openVod(kind) {
    const back = Nav.state();
    const xs = Store.playlists().filter(p => p.type === 'xtream' && !p.off);
    if (!xs.length) { doc(t(kind === 'series' ? 'vod_series' : 'vod_movies'), t('vod_none'), back); return; }
    const go = p => { closeDrawer(); closeGuide(); vodOpen(p, kind); };
    if (pl && pl.type === 'xtream' && xs.some(p => p.id === pl.id)) return go(xs.find(p => p.id === pl.id));
    if (xs.length === 1) return go(xs[0]);
    pick(t(kind === 'series' ? 'vod_series' : 'vod_movies'), xs.map(p => ({ label: p.name })), i => go(xs[i]), back);
  }
  async function vodOpen(p, kind, force) {
    Player.stop();
    vodPl = p; vodKind = kind;
    show('vod');
    $('vod-title').textContent = (kind === 'series' ? '📺  ' + t('vod_series') : '🎬  ' + t('vod_movies')) + '  ·  ' + p.name;
    $('vod-cats').innerHTML = ''; $('vod-grid').innerHTML = '';
    vodStatus('⏳');
    Nav.setScope($('scr-vod'), vodBack, vodKeys);
    const key = p.id + '|' + kind;
    try {
      if (force || !vodCache || vodCache.key !== key || Date.now() - vodCache.at > 30 * 60e3) {
        vodCache = null;   // держим в памяти только один раздел — фильмов бывают десятки тысяч
        const api = vodApi(p), series = kind === 'series';
        let cats = [];
        try { cats = await vodGet(api + '&action=' + (series ? 'get_series_categories' : 'get_vod_categories')); } catch (e) { }
        const raw = await vodGet(api + '&action=' + (series ? 'get_series' : 'get_vod_streams'));
        const items = (Array.isArray(raw) ? raw : []).map(o => ({
          id: String((series ? o.series_id : o.stream_id) || ''), name: String(o.name || '').trim(),
          poster: (series ? o.cover : o.stream_icon) || '', cat: String(o.category_id || ''),
          rating: vodRating(o), year: vodYear(o), ext: series ? '' : (o.container_extension || '')
        })).filter(x => x.id && x.name).map(x => ({ ...x, poster: /^http/i.test(x.poster) ? x.poster : '' }));
        const known = new Set((cats || []).map(c => String(c.category_id)));
        const used = new Set(items.map(x => x.cat));
        const list = (cats || []).filter(c => used.has(String(c.category_id))).map(c => ({ id: String(c.category_id), name: String(c.category_name || '').trim() }));
        if (items.some(x => !known.has(x.cat))) { list.push({ id: '', name: t('misc') }); items.forEach(x => { if (!known.has(x.cat)) x.cat = ''; }); }
        vodCache = { key, at: Date.now(), list: { cats: list, items } };
      }
    } catch (e) {
      vodStatus(t('vod_error', e.message || String(e)));
      Nav.setScope($('scr-vod'), vodBack, ev => { if (ev.keyCode === 13) { vodOpen(p, kind, true); return true; } return false; });
      return;
    }
    vodList = vodCache.list;
    // «Скрыть 18+»: взрослые разделы и названия не показываем
    if (Store.parental()) {
      const bad = new Set(vodList.cats.filter(c => isAdultName(c.name)).map(c => c.id));
      vodList = { cats: vodList.cats.filter(c => !bad.has(c.id)), items: vodList.items.filter(x => !bad.has(x.cat) && !isAdultName(x.name)) };
    }
    vodCat = null; vodQuery = '';
    vodRenderCats();
    vodShowItems();
    Nav.setScope($('scr-vod'), vodBack, vodKeys);
    Nav.focus($('vod-cats').children[1] || $('vod-cats').firstChild);
  }
  function vodStatus(text) { const s = $('vod-status'); s.textContent = text || ''; s.classList.toggle('hidden', !text); }
  function vodRenderCats() {
    const box = $('vod-cats');
    box.innerHTML = '';
    const add = (label, on, act) => {
      const el = document.createElement('div');
      el.className = 'grp focusable' + (on ? ' on' : '');
      el.tabIndex = 0;
      el.textContent = label;
      el.onclick = act;
      box.appendChild(el);
    };
    add('🔍  ' + t('vod_search') + (vodQuery ? ': ' + vodQuery : ''), !!vodQuery, () => inputDialog(t('vod_search'), vodQuery, false, v => {
      vodQuery = v; vodCat = null;
      setTimeout(() => { vodRenderCats(); vodShowItems(); Nav.setScope($('scr-vod'), vodBack, vodKeys); Nav.focus($('vod-grid').firstChild || $('vod-cats').firstChild); }, 0);
    }, () => { Nav.setScope($('scr-vod'), vodBack, vodKeys); Nav.focus($('vod-cats').firstChild); }));
    add(t('vod_all') + '  (' + vodList.items.length + ')', vodCat === null && !vodQuery, () => vodPickCat(null));
    vodList.cats.forEach(c => add(c.name, vodCat === c.id, () => vodPickCat(c.id)));
  }
  function vodPickCat(id) {
    vodCat = id; vodQuery = '';
    const i = id === null ? 1 : 2 + vodList.cats.findIndex(c => c.id === id);
    vodRenderCats();
    vodShowItems();
    Nav.focus($('vod-cats').children[i]);
  }
  function vodShowItems() {
    const q = vodQuery.toLowerCase();
    vodItems = vodList.items.filter(x => q ? x.name.toLowerCase().includes(q) : vodCat === null || x.cat === vodCat);
    $('vod-grid').innerHTML = '';
    $('vod-grid').scrollTop = 0;
    vodShownN = 0;
    vodMore();
    vodStatus(vodItems.length ? '' : t('vod_empty'));
  }
  // Постеры добавляются частями по мере листания (все сразу телевизор рисовал бы долго)
  function vodMore() {
    const box = $('vod-grid');
    vodItems.slice(vodShownN, vodShownN + VOD_PAGE).forEach(x => {
      const el = document.createElement('div');
      el.className = 'vod-item focusable';
      el.tabIndex = 0;
      const pic = document.createElement('div');
      pic.className = 'vod-pic';
      pic.textContent = x.name.slice(0, 1);
      if (x.poster) { const img = document.createElement('img'); img.loading = 'lazy'; img.src = x.poster; img.onerror = () => img.remove(); pic.appendChild(img); }
      const name = document.createElement('div');
      name.className = 'vod-name';
      name.textContent = x.name;
      const meta = document.createElement('div');
      meta.className = 'vod-meta';
      meta.textContent = [x.year, x.rating ? '★ ' + x.rating : ''].filter(Boolean).join('   ');
      el.append(pic, name, meta);
      el.onclick = () => vodItem(x);
      box.appendChild(el);
    });
    vodShownN = Math.min(vodItems.length, vodShownN + VOD_PAGE);
  }
  function vodKeys(e) {
    const el = document.activeElement;
    const k = e.keyCode;
    // Из списка разделов ▶ — к постерам; с левого столбца постеров ◀ — к разделам
    if (k === 39 && el && el.closest('#vod-cats')) { const f = $('vod-grid').firstChild; if (f) Nav.focus(f); return true; }
    if (el && el.classList.contains('vod-item')) {
      const all = [...$('vod-grid').children];
      const i = all.indexOf(el);
      if (k === 37 && i % 6 === 0) { Nav.focus($('vod-cats').querySelector('.grp.on') || $('vod-cats').firstChild); return true; }
      if ((k === 40 || k === 34) && i + 12 >= all.length && vodShownN < vodItems.length) vodMore();
    }
    return false;
  }
  function vodBack() {
    const el = document.activeElement;
    if (el && el.classList.contains('vod-item')) { Nav.focus($('vod-cats').querySelector('.grp.on') || $('vod-cats').firstChild); return; }
    // Назад к каналам: снова включается последний канал
    show('player');
    if (pl) openGuide(pl, null, true); else openPlaylists();
  }
  // Где остановились в фильме или серии (без логина и пароля — только вид и номер)
  function posKey(url) { return 'vodpos.' + (url.includes('/series/') ? 's.' : 'm.') + url.split('/').pop(); }
  function vodPos(url) { return +localStorage.getItem(posKey(url)) || 0; }
  function setVodPos(url, ms) { try { if (ms > 0) localStorage.setItem(posKey(url), String(ms)); else localStorage.removeItem(posKey(url)); } catch (e) { } }
  function timeText(ms) {
    const s = Math.floor(ms / 1000);
    const two = n => String(n).padStart(2, '0');
    return s >= 3600 ? Math.floor(s / 3600) + ':' + two(Math.floor(s / 60) % 60) + ':' + two(s % 60) : Math.floor(s / 60) + ':' + two(s % 60);
  }
  function vodUrl(kind, id, ext) {
    const p = vodPl;
    return M3U.normalizeServer(p.server) + '/' + kind + '/' + encodeURIComponent(p.user) + '/' + encodeURIComponent(p.pass) + '/' + id + '.' + (ext || 'mp4');
  }
  // Окно фильма или сериала: постер, описание, кнопки
  function vodInfo(x, meta, plot, buttons) {
    const back = () => { $('vodinfo').classList.add('hidden'); Nav.setScope($('scr-vod'), vodBack, vodKeys); };
    $('vi-pic').innerHTML = '';
    if (x.poster) { const img = document.createElement('img'); img.src = x.poster; img.onerror = () => img.remove(); $('vi-pic').appendChild(img); }
    $('vi-title').textContent = x.name;
    $('vi-meta').textContent = meta;
    $('vi-plot').textContent = plot;
    const box = $('vi-list');
    box.innerHTML = '';
    buttons.forEach(([label, act]) => {
      const el = document.createElement('div');
      el.className = 'pick-item focusable';
      el.tabIndex = 0;
      el.textContent = label;
      el.onclick = act;
      box.appendChild(el);
    });
    $('vodinfo').classList.remove('hidden');
    const focusEl = document.activeElement;
    Nav.setScope($('vodinfo'), () => { back(); Nav.focus(focusEl); });
    Nav.focus(box.firstChild);
  }
  async function vodItem(x) {
    const from = document.activeElement;
    vodStatus('⏳');
    let info = null, episodes = [];
    try {
      if (vodKind === 'series') {
        const root = await vodGet(vodApi(vodPl) + '&action=get_series_info&series_id=' + encodeURIComponent(x.id));
        info = root.info || null;
        const eps = root.episodes;
        let seasons = [];
        if (eps && !Array.isArray(eps) && typeof eps === 'object') seasons = Object.keys(eps).map(k => [k, eps[k]]);
        else if (Array.isArray(eps)) seasons = eps.map((a, i) => [(a && a[0] && a[0].season) || String(i + 1), a]);
        seasons.sort((a, b) => (parseInt(a[0], 10) || 1e9) - (parseInt(b[0], 10) || 1e9));
        seasons.forEach(([season, arr]) => {
          const list = (arr || []).filter(Boolean).map((e, i) => ({
            id: String(e.id || ''), season: String(e.season || season), number: String(e.episode_num || i + 1),
            title: String(e.title || '').trim(), ext: e.container_extension || '', plot: String((e.info && e.info.plot) || '').trim()
          }));
          list.sort((a, b) => (parseInt(a.number, 10) || 1e9) - (parseInt(b.number, 10) || 1e9));
          episodes.push(...list.filter(e => e.id));
        });
      } else {
        try { info = (await vodGet(vodApi(vodPl) + '&action=get_vod_info&vod_id=' + encodeURIComponent(x.id))).info || null; } catch (e) { }
      }
    } catch (e) {
      vodStatus('');
      doc(x.name, e.message || String(e), () => { Nav.setScope($('scr-vod'), vodBack, vodKeys); Nav.focus(from); });
      return;
    }
    vodStatus('');
    const i = info || {};
    const meta = [x.year, x.rating ? '★ ' + x.rating : '', i.duration || '', i.genre || ''].filter(Boolean).join('   ·   ');
    const plot = String(i.plot || i.description || '').trim();
    if (vodKind !== 'series') {
      const url = vodUrl('movie', x.id, x.ext);
      const at = vodPos(url);
      const btns = at > 0
        ? [[t('vod_resume', timeText(at)), () => vodPlay(x, [url], [x.name], 0, null, at)], [t('vod_from_start'), () => vodPlay(x, [url], [x.name], 0, null, 0)]]
        : [[t('vod_watch'), () => vodPlay(x, [url], [x.name], 0, null, 0)]];
      vodInfo(x, meta, plot, btns);
      return;
    }
    if (!episodes.length) { doc(x.name, t('vod_empty'), () => { Nav.setScope($('scr-vod'), vodBack, vodKeys); Nav.focus(from); }); return; }
    const urls = episodes.map(e => vodUrl('series', e.id, e.ext));
    const titles = episodes.map(e => x.name + ' · ' + t('vod_se', e.season, e.number) + (e.title && !e.title.includes(x.name) ? ' · ' + e.title : ''));
    const playEp = j => vodPlay(x, urls, titles, j, episodes.map(e => e.id), vodPos(urls[j]));
    const btns = [];
    const last = localStorage.getItem('vodlast.' + vodPl.id + '.' + x.id);
    const li = episodes.findIndex(e => e.id === last);
    if (li >= 0) btns.push([t('vod_continue', episodes[li].season, episodes[li].number), () => playEp(li)]);
    const seasons = [...new Set(episodes.map(e => e.season))];
    seasons.forEach(s => {
      const inS = episodes.map((e, j) => ({ e, j })).filter(o => o.e.season === s);
      btns.push([t('vod_season', s, inS.length), () => pick(t('vod_season', s, inS.length),
        inS.map(o => ({ label: (o.e.title || t('vod_episode_n', o.e.number)) + (vodPos(urls[o.j]) > 0 ? '   ⏵ ' + timeText(vodPos(urls[o.j])) : ''), on: o.j === li })),
        k => playEp(inS[k].j), () => { Nav.setScope($('vodinfo'), () => { $('vodinfo').classList.add('hidden'); Nav.setScope($('scr-vod'), vodBack, vodKeys); Nav.focus(from); }); Nav.focus($('vi-list').firstChild); })]);
    });
    vodInfo(x, meta, plot, btns);
  }
  function vodPlay(item, urls, titles, idx, epIds, at) {
    $('vodinfo').classList.add('hidden');
    vod = { item, urls, titles, idx, epIds, at: at || 0 };
    Radio.hide();
    arch = null;
    show('player');
    closeGuide();
    Player.setRect(null);
    Nav.setScope($('scr-player'), vodExit, playerKeys);
    vodStart();
  }
  function vodStart() {
    const v = vod;
    $('pl-spinner').classList.remove('hidden');
    if (v.epIds) try { localStorage.setItem('vodlast.' + vodPl.id + '.' + v.item.id, v.epIds[v.idx]); } catch (e) { }
    Player.start(v.urls[v.idx]);
    v.seekDone = !(v.at > 0);
    vodBar();
  }
  // Показ пошёл — перематываем туда, где остановились
  Player.on('playing', () => { if (vod && !vod.seekDone) { vod.seekDone = true; setTimeout(() => Player.seekTo(vod.at), 300); } });
  // Раз в 10 секунд запоминаем место
  setInterval(() => {
    if (!vod || screen !== 'player' || !Player.isPlaying()) return;
    const p = Player.pos(), d = Player.duration();
    if (p > 0) setVodPos(vod.urls[vod.idx], d > 0 && p > d - 120000 ? 0 : p);
  }, 10000);
  function vodBar() {
    if (!vod) return;
    const p = Player.pos(), d = Player.duration();
    $('bar-name').textContent = vod.titles[vod.idx];
    $('bar-group').textContent = vodPl ? vodPl.name : '';
    $('bar-num').textContent = vod.epIds ? '' : '🎬';
    $('bar-logo').classList.add('hidden');
    $('bar-prog').textContent = (Player.isPaused() ? '⏸  ' : '▶  ') + timeText(p) + (d > 0 ? '  /  ' + timeText(d) : '');
    $('bar-next').textContent = ''; $('bar-next2').textContent = '';
    $('bar-left').textContent = d > 0 ? '−' + timeText(Math.max(0, d - p)) : '';
    $('bar-fill').style.width = d > 0 ? Math.round(100 * p / d) + '%' : '0';
    $('bar-bubbles').innerHTML = '';
    $('bar').classList.remove('hidden');
    clearTimeout(barTimer);
    barTimer = setTimeout(() => $('bar').classList.add('hidden'), Store.barSec() * 1000);
  }
  setInterval(() => { if (vod && !$('bar').classList.contains('hidden')) vodBar(); }, 1000);
  // ◀ — назад на 10 с, ▶ — вперёд на 30 с (нажатия складываются)
  let vodSeek = 0, vodSeekTimer = null;
  function vodSeekBy(ms) {
    vodSeek += ms;
    toast((vodSeek >= 0 ? '⏩  ' : '⏪  ') + t('seek_seconds', (vodSeek >= 0 ? '+' : '−') + Math.abs(vodSeek / 1000)));
    clearTimeout(vodSeekTimer);
    vodSeekTimer = setTimeout(() => {
      const d = Player.duration();
      let to = Player.pos() + vodSeek;
      vodSeek = 0;
      if (d > 0) to = Math.min(to, d - 5000);
      Player.seekTo(Math.max(0, to));
      vodBar();
    }, 700);
  }
  function vodEpisode(step) {
    if (!vod || !vod.epIds) return;
    const j = vod.idx + step;
    if (j < 0 || j >= vod.urls.length) { toast(t('vod_series_end')); return; }
    setVodPos(vod.urls[vod.idx], Player.pos());
    vod.idx = j; vod.at = vodPos(vod.urls[j]);
    vodStart();
  }
  // Фильм или серия закончились: следующая серия или назад к списку
  Player.on('ended', () => {
    if (!vod) return;
    setVodPos(vod.urls[vod.idx], 0);
    if (vod.epIds && vod.idx + 1 < vod.urls.length) { vod.idx++; vod.at = vodPos(vod.urls[vod.idx]); vodStart(); return; }
    toast(t(vod.epIds ? 'vod_series_end' : 'vod_movie_end'));
    vodExit();
  });
  function vodMenu() {
    const items = [
      { label: t('audio_track'), act: openAudioMenu },
      { label: t('choose_subtitles'), act: openSubsMenu },
      { label: t('size_title'), act: () => sizeMenu(vodScope) }
    ];
    pick(vod.titles[vod.idx], items.map(i => ({ label: i.label })), i => items[i].act(), vodScope);
  }
  const vodScope = () => playerScope();
  function vodExit() {
    if (!vod) return;
    const p = Player.pos(), d = Player.duration();
    if (p > 0) setVodPos(vod.urls[vod.idx], d > 0 && p > d - 120000 ? 0 : p);
    vod = null;
    Player.stop();
    $('bar').classList.add('hidden');
    show('vod');
    Nav.setScope($('scr-vod'), vodBack, vodKeys);
    Nav.focus($('vod-grid').querySelector('.vod-item') || $('vod-cats').firstChild);
  }

  // ---------- Смотреть рядом: два канала на экране (Samsung, два родных плеера) ----------
  let split = -1;   // номер второго канала в списке, −1 — обычный просмотр
  function splitPick() {
    const list = shown.map((c, i) => ({ c, i })).filter(x => x.i !== cur);
    if (!list.length) return playerScope();
    pick(t('split_watch'), list.map(x => ({ label: (x.i + 1) + '  ' + dispName(x.c) })), j => splitStart(list[j].i), playerScope);
  }
  function splitStart(j) {
    split = (j + shown.length) % shown.length;
    Radio.hide();
    $('bar').classList.add('hidden');
    Player.split(shown[cur].url, shown[split].url);
    Nav.setScope($('scr-player'), splitEnd, splitKeys);
    toast(dispName(shown[cur]) + '  |  ' + dispName(shown[split]));
  }
  // ▲▼ — другой канал справа, OK — правый канал на весь экран, «Назад» — левый канал на весь экран
  function splitKeys(e) {
    const k = e.keyCode;
    if (k === 38 || k === 427 || k === 40 || k === 428) {
      let j = split;
      do { j = (j + (k === 38 || k === 427 ? 1 : -1) + shown.length) % shown.length; } while (j === cur && shown.length > 1);
      splitStart(j);
      return true;
    }
    if (k === 13) { const j = split; split = -1; Player.splitStop(); playerScope(); play(j); return true; }
    return true;
  }
  function splitEnd() { split = -1; Player.splitStop(); playerScope(); play(cur); }
  Player.on('splitError', msg => { toast(t('play_error')); Store.addLog(t('split_watch') + '\n' + msg); if (split >= 0) splitEnd(); });

  // Размер картинки (удерживать OK на видео): по размеру, растянуть, увеличить — запоминается
  const SIZES = ['fit', 'stretch', 'zoom'];
  function sizeNow() { try { return localStorage.getItem('size') || 'fit'; } catch (e) { return 'fit'; } }
  Player.setSize(sizeNow());
  function sizeMenu(back) {
    pick(t('size_title'), SIZES.map(k => ({ label: t('size_' + k), on: k === sizeNow() })), i => {
      try { localStorage.setItem('size', SIZES[i]); } catch (e) { }
      Player.setSize(SIZES[i]);
      back();
    }, back);
  }

  function toggleFav(c) {
    if (!c) return;
    const f = Store.favorites(), k = favKey(c);
    const on = !f.includes(k);
    Store.saveFavorites(on ? [...f, k] : f.filter(x => x !== k));
    toast(t(on ? 'fav_added' : 'fav_removed'));
  }

  // ---------- Просмотр ----------
  let cur = -1, prev = -1, barTimer = null, retryTimer = null;

  // ---------- Архив передач ----------
  let arch = null, archT0 = 0, pendingSeek = 0, seekTimer = null;
  function streamUrl(c) {
    archT0 = Date.now();
    return arch ? (Catchup.url(c, arch.p, arch.from) || c.url) : c.url;
  }
  // Прошедшая передача: из архива, если он есть у канала
  function playArchive(i, p) {
    const c = shown[i];
    if (!c || !Catchup.available(c, p)) { toast(t('archive_none')); return false; }
    closeGuide(); closeSide();
    play(i, { p });
    toast(t('archive_now', p.t));
    return true;
  }
  // Где сейчас показ архива (время передачи)
  function archPos() { return arch ? arch.from + (Player.pos() || (Date.now() - archT0)) : Date.now(); }
  // ◀▶ в архиве — перемотка на 30 с; несколько быстрых нажатий складываются в один прыжок
  function seekBy(sec) {
    pendingSeek += sec;
    toast((pendingSeek >= 0 ? '⏩  ' : '⏪  ') + t('seek_seconds', (pendingSeek >= 0 ? '+' : '−') + Math.abs(pendingSeek)));
    clearTimeout(seekTimer);
    seekTimer = setTimeout(() => {
      if (!arch) return;
      const p = arch.p;
      const target = Math.min(Date.now() - 60000, Math.max(p.s, Math.min(Math.max(p.s, p.e - 60000), archPos() + pendingSeek * 1000)));
      pendingSeek = 0;
      play(cur, { p, from: target });
    }, 700);
  }
  // Поток кончился: архив — продолжаем с того же места или возвращаемся в эфир; эфир — ошибка
  Player.on('ended', () => {
    if (vod || screen !== 'player' || cur < 0) return;
    if (!arch) return playError('stream ended');
    const at = archPos();
    if (at < arch.p.e - 60000 && at < Date.now() - 60000) play(cur, { p: arch.p, from: at });
    else play(cur);
  });

  Player.on('error', playError);
  function playError(msg) {
    $('pl-spinner').classList.add('hidden');
    if (vod) {
      toast(t('vod_play_error', msg));
      Store.addLog(new Date().toLocaleString(LANG) + ' — ' + vod.titles[vod.idx] + '\n' + msg);
      return;
    }
    if (screen !== 'player' || cur < 0) return;
    const c = shown[cur];
    toast(t('play_error'));
    const d = new Date();
    Store.addLog(d.toLocaleDateString(LANG) + ' ' + hm(d) + ' — ' + (c ? c.name : '') + '\n' + msg + (c ? '\n' + c.url : ''));
  }
  Player.on('buffering', on => $('pl-spinner').classList.toggle('hidden', !on));
  Player.on('playing', () => { $('pl-spinner').classList.add('hidden'); $('guide').classList.toggle('playing', true); });
  // В потоке только звук (а по названию не понять, что радио) — тоже экран радио
  Player.on('playing', () => {
    const c = shown[cur];
    setTimeout(() => {
      if (vod || split >= 0 || !c || shown[cur] !== c || Radio.isOn()) return;
      const i = Player.info();
      if (i.ch > 0 && !i.w && !i.h) { Radio.show(c, dispName(c)); if (!$('guide').classList.contains('hidden')) Radio.visible(false); }
    }, 4000);
  });
  Player.on('tracks', () => { autoAudio(); autoSubs(); });

  const unlocked = new Set();   // каналы, для которых PIN уже введён (до выхода из программы)
  function play(i, a) {
    if (!shown.length) return;
    const want = shown[(i + shown.length) % shown.length];
    if ((isLocked(want) && !unlocked.has(favKey(want))) || (!want._pl && isGroupLocked(want.group) && !unlockedGroups.has(groupKey(want.group)))) {
      const back = Nav.state();
      return checkPin(() => { unlocked.add(favKey(want)); unlockedGroups.add(groupKey(want.group)); play(i, a); }, back);
    }
    // a — передача из архива {p, from}; без него — прямой эфир
    arch = a ? { p: a.p, from: a.from || a.p.s } : null;
    const next = (i + shown.length) % shown.length;
    if (next !== cur) prev = cur;
    cur = next;
    const c = shown[cur];
    playingCh = c;
    show('player');
    closeGuide();
    playerScope();
    $('pl-spinner').classList.remove('hidden');
    const url = streamUrl(c);
    Player.start(url);
    if (Radio.looks(c)) Radio.show(c, dispName(c)); else Radio.hide();
    // Канал не пошёл за 7 с (бывает при запуске программы) — включаем его ещё раз сами
    clearTimeout(retryTimer);
    const my = c;
    retryTimer = setTimeout(() => { if (shown[cur] === my && !Player.isPlaying()) Player.start(url); }, 7000);
    Store.saveLast({ pl: pl.id, group, name: c.name });
    showBar();
  }

  function showBar() {
    const c = shown[cur];
    if (!c) return;
    $('bar-name').textContent = dispName(c);
    $('bar-group').textContent = groupLabel(group);
    $('bar-num').textContent = cur + 1;
    const lg = $('bar-logo');
    lg.onerror = () => lg.classList.add('hidden');
    if (c.logo) { lg.src = c.logo; lg.classList.remove('hidden'); } else lg.classList.add('hidden');
    fillBar();
    $('bar').classList.remove('hidden');
    bubbles();
    clearTimeout(barTimer);
    barTimer = setTimeout(() => $('bar').classList.add('hidden'), Store.barSec() * 1000);
  }

  // «Пузыри» на плашке, как в Android: качество кадра, скорость потока, звук (стерео / 5.1)
  function bubbles() {
    const box = $('bar-bubbles');
    const i = Player.info();
    const out = [];
    if (i.h) out.push(i.h >= 2000 ? '4K' : i.h >= 1400 ? '1440p' : i.h >= 1000 ? '1080p' : i.h >= 700 ? '720p' : i.h + 'p');
    if (i.kbps) out.push(i.kbps >= 1000 ? t('bitrate_mbps', (i.kbps / 1000).toFixed(1)) : t('bitrate_kbps', i.kbps));
    if (i.ch) out.push(i.ch === 1 ? t('sound_mono') : i.ch === 2 ? t('sound_stereo') : i.ch === 6 ? '5.1' : i.ch === 8 ? '7.1' : t('sound_channels', i.ch));
    box.innerHTML = '';
    out.forEach(x => { const b = document.createElement('span'); b.textContent = x; box.appendChild(b); });
  }
  // Пока плашка видна — пузыри обновляются (данные о потоке приходят не сразу)
  setInterval(() => { if (!$('bar').classList.contains('hidden')) { bubbles(); $('bar-clock').textContent = hm(Date.now()); } }, 1500);

  function hm(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function fillBar() {
    const c = shown[cur];
    const n = c && Epg.now(c);
    $('bar-clock').textContent = hm(Date.now());
    // Время и название — отдельно: название на иврите не должно переставлять цифры времени
    const line = (box, p) => {
      box.innerHTML = '';
      if (!p) return;
      const tm = document.createElement('span');
      tm.className = 'tm';
      tm.textContent = hm(p.s) + (box.id === 'bar-prog' ? '–' + hm(p.e) : '');
      const ti = document.createElement('bdi');
      ti.textContent = p.t;
      box.append(tm, ti);
    };
    if (arch) {
      // Архив: какая передача, с какого места; дальше по программе не показываем
      const p = arch.p, at = archPos();
      $('bar-prog').textContent = t('archive_now', hm(p.s) + '–' + hm(p.e) + '  ' + p.t);
      $('bar-next').textContent = (Player.isPaused() ? '⏸  ' : '▶  ') + hm(at);
      $('bar-next2').textContent = '';
      $('bar-left').textContent = t('epg_left_min', Math.max(0, Math.round((p.e - at) / 60000)));
      $('bar-fill').style.width = Math.max(0, Math.min(100, Math.round(100 * (at - p.s) / (p.e - p.s)))) + '%';
      return;
    }
    line($('bar-prog'), n && n.cur);
    if (!n) $('bar-prog').textContent = t('no_epg');
    const after = n ? Epg.list(c).filter(p => p.s >= n.cur.e).slice(0, 2) : [];
    line($('bar-next'), after[0]);
    line($('bar-next2'), after[1]);
    $('bar-left').textContent = n ? t('epg_left_min', Math.max(0, Math.round((n.cur.e - Date.now()) / 60000))) : '';
    $('bar-fill').style.width = n ? Math.round(100 * (Date.now() - n.cur.s) / (n.cur.e - n.cur.s)) + '%' : '0';
  }

  // Программа канала на сегодня и дальше (OK на плашке, удерживать OK, «Инфо»/«Гид»; на компьютере — G или I)
  function openSchedule(c, back) {
    const box = $('sched-list');
    box.innerHTML = '';
    $('sched-title').textContent = c.name;
    const hasArch = Catchup.has(c);
    const list = Epg.list(c).filter(p => p.e > Date.now() - (hasArch ? Catchup.days(c) * 86400e3 : 3600e3));
    let focusEl = null;
    let lastDay = '';
    list.forEach(p => {
      const day = new Date(p.s).toLocaleDateString(LANG, { weekday: 'long', day: 'numeric', month: 'long' });
      if (day !== lastDay) {
        const h = document.createElement('div');
        h.className = 'sched-day';
        h.textContent = day;
        box.appendChild(h);
        lastDay = day;
      }
      const el = document.createElement('div');
      el.className = 'sched-item focusable';
      el.tabIndex = 0;
      const live = p.s <= Date.now() && p.e > Date.now();
      if (live) el.classList.add('live');
      el.innerHTML = '<div class="si-time"></div><div class="si-title"></div><div class="si-desc hidden"></div>';
      el.querySelector('.si-time').textContent = hm(p.s);
      el.querySelector('.si-title').textContent = (live ? '● ' : '') + p.t;
      const desc = el.querySelector('.si-desc');
      desc.textContent = p.d || t('info_no_desc');
      const inArch = p.e <= Date.now() && Catchup.available(c, p);
      if (inArch) el.querySelector('.si-time').textContent = '⏪ ' + hm(p.s);
      // Прошедшая передача из архива — OK включает её; остальные — показать описание
      el.onclick = () => {
        if (inArch) { $('sched').classList.add('hidden'); const i = shown.indexOf(c); if (i >= 0) playArchive(i, p); return; }
        desc.classList.toggle('hidden');
      };
      box.appendChild(el);
      if (!focusEl && (live || p.s > Date.now())) focusEl = el;
    });
    if (!list.length) box.textContent = t('no_epg_channel');
    $('sched').classList.remove('hidden');
    const close = () => { $('sched').classList.add('hidden'); back(); };
    Nav.setScope($('sched'), close);
    Nav.focus(focusEl || box.querySelector('.focusable'));
  }
  const GUIDE_KEYS = [457, 458, 71, 73];

  // ---------- Список поверх видео (◀): каналы | программа выделенного канала | описание передачи ----------
  let sideGroup = ALL, sideShown = [];
  function openSide() {
    sideGroup = group;
    $('side-groups').classList.add('hidden');
    $('side').classList.remove('with-groups');
    $('side').classList.remove('hidden');
    sideScope();
    renderSide(true);
  }
  function sideScope() { Nav.setScope($('side'), sideBack, sideKeys); }
  function renderSide(focusCurrent) {
    const box = $('side-list');
    box.innerHTML = '';
    $('side-title').textContent = groupLabel(sideGroup);
    sideShown = inGroup(sideGroup);
    sideShown.forEach((c, i) => {
      const el = channelRow(c, i);
      el.onclick = () => sidePlay(i);
      el.addEventListener('focus', () => sideEpg(c));
      box.appendChild(el);
    });
    if (!sideShown.length) { box.textContent = t('panel_empty'); sideEpg(null); }
    const playing = shown[cur];
    const idx = focusCurrent && playing ? sideShown.indexOf(playing) : 0;
    Nav.focus(box.children[Math.max(0, idx)]);
  }
  function sidePlay(i, p) {
    closeSide();
    if (sideGroup !== group) { group = sideGroup; setShown(sideShown); prev = -1; }
    if (p) playArchive(i, p); else play(i);
  }
  // Программа выделенного канала (с текущей передачи) и описание передачи под курсором
  function sideEpg(c) {
    const box = $('side-epg');
    box.innerHTML = '';
    $('side-epg-title').textContent = c ? c.name : '';
    const past = c && Catchup.has(c) ? Epg.list(c).filter(p => p.e <= Date.now() && Catchup.available(c, p)).slice(-30) : [];
    const list = c ? Epg.list(c).filter(p => p.e > Date.now()) : [];
    past.forEach(p => {
      const el = document.createElement('div');
      el.className = 'ep-item focusable past';
      el.tabIndex = 0;
      el.innerHTML = '<div class="t"></div><div class="n"></div>';
      el.firstChild.textContent = '⏪ ' + hm(p.s);
      el.lastChild.textContent = p.t;
      el.addEventListener('focus', () => sideDesc(p));
      el.onclick = () => { const i = sideShown.indexOf(c); if (i >= 0) sidePlay(i, p); };
      box.appendChild(el);
    });
    list.slice(0, 60).forEach(p => {
      const el = document.createElement('div');
      el.className = 'ep-item focusable' + (p.s <= Date.now() ? ' live' : '');
      el.tabIndex = 0;
      el.innerHTML = '<div class="t"></div><div class="n"></div>';
      el.firstChild.textContent = hm(p.s);
      el.lastChild.textContent = p.t;
      el.addEventListener('focus', () => sideDesc(p));
      el.onclick = () => { const i = sideShown.indexOf(c); if (i >= 0) sidePlay(i); };
      box.appendChild(el);
    });
    if (c && !list.length) box.textContent = t('no_epg_channel');
    sideDesc(list[0] || null);
    const lv = box.querySelector('.ep-item:not(.past)');
    if (lv && past.length) box.scrollTop = lv.offsetTop - box.clientHeight / 3;
  }
  function sideDesc(p) {
    $('sd-title').textContent = p ? p.t : '';
    $('sd-time').textContent = p ? hm(p.s) + '–' + hm(p.e) : '';
    $('sd-text').textContent = p ? (p.d || t('info_no_desc')) : '';
  }
  function openSideGroups() {
    const box = $('side-groups');
    box.innerHTML = '';
    groupsOf(channels).forEach(g => {
      const el = document.createElement('div');
      el.className = 'grp focusable' + (g === sideGroup ? ' on' : '');
      el.tabIndex = 0;
      el.textContent = groupName(g);
      el.onclick = () => openLockedGroup(g, null, () => { sideScope(); sideGroup = g; hideSideGroups(); renderSide(false); }, () => { sideScope(); openSideGroups(); });
      box.appendChild(el);
    });
    box.classList.remove('hidden');
    $('side').classList.add('with-groups');
    Nav.focus(box.querySelector('.grp.on') || box.firstChild);
  }
  function hideSideGroups() { $('side-groups').classList.add('hidden'); $('side').classList.remove('with-groups'); }
  let moving = null;   // канал, который сейчас перемещаем в избранном
  function sideKeys(e) {
    const el = document.activeElement;
    if (moving) return moveKeys(e);
    if (digitKey(e)) return true;
    if (e.keyCode === 13 && el && el.classList.contains('ch') && el.closest('#side-list')) {
      const i = [...$('side-list').children].indexOf(el);
      const again = () => { sideScope(); renderSide(false); Nav.focus($('side-list').children[Math.min(i, $('side-list').children.length - 1)]); };
      return holdOk(e, () => sidePlay(i), () => {
        // В папке «Избранное» — меню (убрать, переместить, переименовать, PIN); в остальных папках канал сразу добавляется в избранное
        if (sideGroup === FAV) chMenu(sideShown[i], again, { move: () => startMove(sideShown[i]) });
        else { toggleFav(sideShown[i]); again(); }
      });
    }
    // Список каналов по кругу: с последнего вниз — на первый, с первого вверх — на последний
    if ((e.keyCode === 38 || e.keyCode === 40) && el && el.classList.contains('ch') && el.closest('#side-list')) {
      const list = [...$('side-list').children];
      const i = list.indexOf(el);
      if (e.keyCode === 40 && i === list.length - 1) { Nav.focus(list[0]); return true; }
      if (e.keyCode === 38 && i === 0) { Nav.focus(list[list.length - 1]); return true; }
    }
    const where = el && (el.closest('#side-groups') ? 'groups' : el.closest('#side-epg') ? 'epg' : 'channels');
    if (e.keyCode === 37) {
      if (where === 'channels') { openSideGroups(); return true; }
      if (where === 'epg') { const c = $('side-epg-title').textContent; const i = sideShown.findIndex(x => x.name === c); Nav.focus($('side-list').children[Math.max(0, i)]); return true; }
      return true;
    }
    if (e.keyCode === 39) {
      if (where === 'groups') { hideSideGroups(); Nav.focus($('side-list').firstChild); return true; }
      if (where === 'channels') { const f = $('side-epg').querySelector('.ep-item:not(.past)') || $('side-epg').querySelector('.ep-item'); if (f) { Nav.focus(f); f.scrollIntoView({ block: 'center' }); } return true; }
      return true;
    }
    return false;
  }
  // Перемещение в избранном: ▲▼ — на строку, ◀ — в самый верх, ▶ — в самый низ, OK или «Назад» — готово
  function startMove(c) {
    moving = favKey(c);
    sideScope();
    renderMove();
    toast(t('move_hint'));
  }
  function renderMove() {
    sideGroup = FAV;
    renderSide(false);
    const i = Store.favorites().indexOf(moving);
    const el = $('side-list').children[i];
    if (el) { el.classList.add('moving'); Nav.focus(el); }
  }
  function moveKeys(e) {
    const f = Store.favorites();
    const i = f.indexOf(moving);
    const k = e.keyCode;
    let j = i;
    if (k === 38) j = Math.max(0, i - 1);
    else if (k === 40) j = Math.min(f.length - 1, i + 1);
    else if (k === 37) j = 0;
    else if (k === 39) j = f.length - 1;
    else if (k === 13 || [27, 8, 10009, 461].includes(k)) { moving = null; renderSide(false); setShown(inGroup(group)); Nav.focus($('side-list').children[i]); return true; }
    else return true;
    f.splice(i, 1);
    f.splice(j, 0, moving);
    Store.saveFavorites(f);
    renderMove();
    return true;
  }
  function sideBack() {
    if (!$('side-groups').classList.contains('hidden')) { hideSideGroups(); Nav.focus($('side-list').firstChild); return; }
    closeSide();
  }
  function closeSide() {
    $('side').classList.add('hidden');
    hideSideGroups();
    if (!$('guide').classList.contains('hidden')) return;
    playerScope();
  }

  // ---------- Звуковые дорожки и субтитры ----------
  // Трёхбуквенные коды из потоков → обычные, чтобы назвать язык словами
  const ISO3 = { rus: 'ru', eng: 'en', heb: 'he', ara: 'ar', fra: 'fr', fre: 'fr', ita: 'it', jpn: 'ja', kor: 'ko',
    zho: 'zh', chi: 'zh', ukr: 'uk', deu: 'de', ger: 'de', spa: 'es', tur: 'tr', pol: 'pl', por: 'pt', ron: 'ro', rum: 'ro', bul: 'bg' };
  function code(l) { l = (l || '').toLowerCase().split(/[-_]/)[0]; return ISO3[l] || (l === 'iw' ? 'he' : l); }
  function langName(l) {
    const c = code(l);
    if (!c || c === 'und' || c === 'mis' || c.length > 3) return '';
    try { const n = new Intl.DisplayNames([LANG], { type: 'language' }).of(c); if (n && n !== c) return n.charAt(0).toUpperCase() + n.slice(1); } catch (e) { }
    return c.toUpperCase();
  }
  // Название дорожки: язык словами, имя из потока (если оно не повторяет язык и не «???»), иначе «Дорожка N»
  function trackLabel(x, i) {
    const ln = langName(x.lang);
    const nm = (x.name || '').trim();
    let en = '';
    try { en = new Intl.DisplayNames(['en'], { type: 'language' }).of(code(x.lang)) || ''; } catch (e) { }
    const same = y => y && nm.toLowerCase() === y.toLowerCase();
    const useful = nm && !/^\?+$/.test(nm) && !same(x.lang) && !same(code(x.lang)) && !same(ln) && !same(en);
    if (ln && useful) return ln + ' · ' + nm;
    return ln || (useful ? nm : t('track_n', i + 1));
  }
  // Язык из настроек: звук — если такой дорожки нет, остаётся как задаёт канал; субтитры — выключены, если не выбраны
  function autoAudio() {
    const want = Store.audio();
    if (!want) return;
    const list = Player.audioTracks();
    const i = list.findIndex(a => code(a.lang) === code(want));
    if (i >= 0 && !list[i].on) Player.setAudio(i);
  }
  function autoSubs() {
    const want = Store.subs();
    const i = want ? Player.subTracks().findIndex(s => code(s.lang) === code(want)) : -1;
    Player.setSub(i);
  }
  function openAudioMenu() {
    const list = Player.audioTracks();
    if (!list.length) { toast(t('no_tracks')); return; }
    if (list.length === 1) { toast(t('one_track')); return; }
    pick(t('audio_track'), list.map((a, i) => ({ label: trackLabel(a, i), on: a.on })), i => { Player.setAudio(i); playerScope(); }, playerScope);
  }
  function openSubsMenu() {
    const list = Player.subTracks();
    if (!list.length) { toast(t('no_subtitles')); return; }
    const items = [{ label: t('subs_off'), on: !list.some(s => s.on) }, ...list.map((s, i) => ({ label: trackLabel(s, i), on: s.on }))];
    pick(t('choose_subtitles'), items, i => { Player.setSub(i - 1); playerScope(); }, playerScope);
  }

  // Пульт на видео — как в Android-версии:
  // OK — плашка, ещё раз OK или удерживать OK — программа; ◀ — каналы, удерживать — звук;
  // ▶ — предыдущий канал, удерживать — субтитры; ▲▼ и кнопки каналов — соседний канал
  const HOLD_MS = 600;
  let hold = null;
  function playerScope() { Nav.setScope($('scr-player'), vod ? vodExit : backFromPlayer, playerKeys); }
  function playerKeys(e) {
    if (!$('side').classList.contains('hidden')) return false;
    const k = e.keyCode;
    if (!vod && digitKey(e)) return true;
    if (k === 13 || k === 37 || k === 39) {
      if (!hold) hold = { k, fired: false, timer: setTimeout(() => { if (hold) { hold.fired = true; longPress(hold.k); } }, HOLD_MS) };
      return true;
    }
    if (vod) {
      if (k === 38 || k === 427 || k === 33) { vodEpisode(1); return true; }
      if (k === 40 || k === 428 || k === 34) { vodEpisode(-1); return true; }
      if (k === 415 || k === 19 || k === 10252) { Player.pause(); vodBar(); return true; }   // кнопки «Пауза» и «Воспроизвести» на пульте
      if (k === 412 || k === 417) { vodSeekBy(k === 412 ? -10000 : 30000); return true; }    // перемотка на пульте
      return false;
    }
    if (arch && (k === 412 || k === 417)) { seekBy(k === 412 ? -30 : 30); return true; }
    if (arch && (k === 415 || k === 19 || k === 10252)) { Player.pause(); showBar(); return true; }
    switch (k) {
      case 38: case 427: play(cur + 1); return true;   // вверх / канал+ — следующий номер (как в Android)
      case 40: case 428: play(cur - 1); return true;   // вниз / канал− — предыдущий номер
    }
    if (GUIDE_KEYS.includes(k)) { openSchedule(shown[cur], playerScope); return true; }
    return false;
  }
  document.addEventListener('keyup', e => {
    if (!hold || hold.k !== e.keyCode) return;
    clearTimeout(hold.timer);
    const h = hold;
    hold = null;
    if (!h.fired) shortPress(h.k);
  });
  function shortPress(k) {
    // Фильм или серия: OK — пауза, ◀ — назад 10 с, ▶ — вперёд 30 с
    if (vod) {
      if (k === 13) { Player.pause(); vodBar(); return; }
      if (k === 37 || k === 39) { vodSeekBy(k === 37 ? -10000 : 30000); return; }
    }
    // В архиве: OK — пауза и продолжение, ◀▶ — перемотка на 30 секунд
    if (arch) {
      if (k === 13) { Player.pause(); showBar(); return; }
      if (k === 37 || k === 39) { seekBy(k === 37 ? -30 : 30); return; }
    }
    if (k === 13) {
      if ($('bar').classList.contains('hidden')) showBar();
      else { $('bar').classList.add('hidden'); openInfo(shown[cur]); }
    } else if (k === 37) openSide();
    else if (k === 39) { if (prev >= 0 && prev < shown.length) play(prev); else showBar(); }
  }
  function longPress(k) {
    if (k === 13 && vod) { vodMenu(); return; }
    if (k === 13) playerMenu();
    else if (k === 37) openAudioMenu();
    else if (k === 39) openSubsMenu();
  }

  // «Назад» на видео — телепрограмма сеткой (видео уменьшается в окно), как в Android
  function backFromPlayer() {
    if (hold) { clearTimeout(hold.timer); hold = null; }
    $('bar').classList.add('hidden');
    openGuide(pl);
  }

  let toastTimer = null;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    // Подсказка видна и на экране каналов
    if (screen !== 'player') document.body.appendChild(el); else $('scr-player').appendChild(el);
    el.style.zIndex = 9;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
  }

  // ---------- Пульт Samsung: цветные кнопки и каналы ----------
  try {
    if (window.tizen && tizen.tvinputdevice) {
      ['ChannelUp', 'ChannelDown', 'ColorF1Green', 'ColorF2Yellow', 'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaRewind', 'MediaFastForward', 'Info', 'Guide', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].forEach(k => { try { tizen.tvinputdevice.registerKey(k); } catch (e) { } });
    }
  } catch (e) { }

  // ---------- Часы на экране (как в Android): справа или слева вверху, белые или переливающиеся ----------
  function clockValue() {
    const c = Store.clock();
    if (c !== 'right' && c !== 'left') return t('clock_off');
    return t(c === 'right' ? 'clock_right' : 'clock_left') + ' · ' + t(Store.clockRainbow() ? 'clock_rainbow' : 'clock_white');
  }
  function chooseClock(back) {
    const vals = ['off', 'right', 'left'];
    pick(t('st_clock'), vals.map(v => ({ label: t('clock_' + v), on: v === Store.clock() })), i => {
      Store.saveClock(vals[i]);
      applyClock();
      if (i === 0) return back();
      // Сразу и вид часов
      pick(t('clock_style'), [{ label: t('clock_white'), on: !Store.clockRainbow() }, { label: t('clock_rainbow'), on: Store.clockRainbow() }],
        j => { Store.saveClockRainbow(j === 1); applyClock(); back(); }, back);
    }, back);
  }
  function applyClock() {
    const el = $('clock');
    const c = Store.clock();
    el.classList.toggle('hidden', c !== 'right' && c !== 'left');
    el.classList.toggle('left', c === 'left');
    el.classList.toggle('rainbow', Store.clockRainbow());
    el.textContent = hm(Date.now());
  }
  setInterval(() => { if (!$('clock').classList.contains('hidden')) $('clock').textContent = hm(Date.now()); }, 5000);
  applyClock();

  // ---------- Телепрограмма: для каждого плейлиста — откуда берётся, как прошла загрузка, свои источники ----------
  function epgSettings(back) {
    const list = Store.playlists();
    if (!list.length) { doc(t('st_epg'), t('empty_playlists'), back); return; }
    pick(t('st_epg'), list.map(p => ({ label: p.name })), i => epgOne(list[i], () => epgSettings(back)), back);
  }
  function epgOne(p, back) {
    const data = Store.channels(p.id) || {};
    const own = (p.epg || '').trim();
    const used = (data.epg || []);
    const rep = Epg.lastReport(p.id);
    let text = t('epg_used') + '\n' + (used.length ? used.join('\n') : t('epg_none')) + '\n\n' + t('epg_last') + ' ';
    if (!rep) text += t('epg_never');
    else {
      text += new Date(rep.time).toLocaleString(LANG);
      (rep.report || []).forEach(r => { text += '\n' + (r.ok ? t('epg_rep_ok', r.url, r.n, r.sec) : r.url + ': ' + r.err); });
    }
    text += '\n\n' + t('epg_note');
    doc(p.name + ' · ' + t('st_epg'), text, () => pick(p.name, [{ label: t('epg_own') + (own ? ': ' + own.split(/\s+/)[0] + (own.split(/\s+/).length > 1 ? ' …' : '') : '') }, { label: t('epg_refresh') }], j => {
      if (j === 0) inputDialog(t('epg_own_hint'), own, false, v => {
        const all = Store.playlists();
        const x = all.find(q => q.id === p.id);
        if (x) { x.epg = v; Store.savePlaylists(all); }
        setTimeout(() => epgOne(x || p, back), 0);
      }, () => epgOne(p, back));
      else {
        // Заново: плейлист (в нём может быть другой адрес программы) и сама программа
        toast(t('epg_reloading'));
        M3U.load(p, t('no_group'), n => t('channel_n', n)).then(fresh => {
          Store.saveChannels(p.id, fresh);
          return Epg.reload(p.id, fresh.epg || [], fresh.channels);
        }).then(() => { toast(t('refreshed')); if (pl && pl.id === p.id) refreshProgs(); }).catch(e => toast(t('refresh_failed', errorText(e))));
        back();
      }
    }, back));
  }

  // ---------- Родительский контроль 18+ ----------
  function chooseParental(back) {
    const toggle = () => {
      const on = !Store.parental();
      const apply = () => {
        Store.saveParental(on);
        if (pl) { const d = Store.channels(pl.id); if (d) { channels = noAdult(d.channels); setShown(inGroup(group)); } }
        toast(t(on ? 'parental_on' : 'parental_off'));
        back();
      };
      // Включить — задать PIN, если его нет; выключить — только с PIN-кодом
      if (on) ensurePin(apply, back); else checkPin(apply, back);
    };
    if (!Store.pin()) return toggle();
    pick(t('st_parental'), [{ label: t(Store.parental() ? 'parental_show_adult' : 'parental_hide_adult') }, { label: t('parental_change_pin') }],
      i => (i === 0 ? toggle() : changePin(back)), back);
  }
  function changePin(back) {
    checkPin(() => newPin(v => { Store.savePin(v); toast(t('parental_pin_changed')); back(); }, back), back);
  }
  // Новый PIN: от 4 цифр, ещё раз для проверки
  function newPin(done, back) {
    inputDialog(t('pin_new'), '', true, (v, err) => {
      if (!/^\d{4,}$/.test(v)) { err(t('pin_new')); return false; }
      setTimeout(() => inputDialog(t('pin_repeat'), '', true, (w, err2) => {
        if (w !== v) { err2(t('pin_mismatch')); return false; }
        setTimeout(() => done(v), 0);
      }, back), 0);
    }, back);
  }

  // ---------- PIN-код на вход в программу (по умолчанию выключен) ----------
  function appPinSettings(back) {
    if (!Store.appPin()) {
      newPin(v => { Store.saveAppPin(v); toast(t('pin_enabled')); back(); }, back);
      return;
    }
    pick(t('pin_button'), [{ label: t('pin_disable') }], () => {
      inputDialog(t('pin_current'), '', true, (v, err) => {
        if (v !== Store.appPin()) { err(t('pin_wrong')); return false; }
        Store.saveAppPin(null);
        toast(t('pin_disabled'));
        setTimeout(back, 0);
      }, back);
    }, back);
  }
  // При запуске: спросить PIN до того, как что-то показать
  function askAppPin(then) {
    if (!Store.appPin()) return then();
    let tries = 0;
    const ask = () => inputDialog(t('pin_enter'), '', true, (v, err) => {
      if (v === Store.appPin()) { setTimeout(then, 0); return; }
      tries++;
      err(t('pin_wrong'));
      return false;
    }, () => askExit());
    $('pin-cover').classList.remove('hidden');
    ask();
  }

  // ---------- Заставка: логотип «надувается», как пузырь ----------
  function splash(then) {
    const el = $('splash');
    el.classList.remove('hidden');
    setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.classList.add('hidden'); then(); }, 350); }, 1300);
  }

  // ---------- Старт: открываем там, где закрыли ----------
  // Проверочная сборка на телевизоре Марка: при переустановке память программы стирается.
  // Если рядом с программой лежит dev.json (только в его копии на компьютере, в магазинную версию не входит),
  // плейлисты из него добавляются сами, когда список пуст
  async function devPlaylists() {
    if (Store.playlists().length) return;
    try {
      const r = await fetch('dev.json', { cache: 'no-store' });
      if (!r.ok) return;
      const list = (await r.json()).playlists || [];
      if (list.length) Store.savePlaylists(list.map((p, i) => Object.assign({ id: 'dev' + i, type: 'm3u', epg: '' }, p)));
    } catch (e) { }
  }
  // Как в Android: сразу играет последний канал; если его нет — телепрограмма; нет плейлистов — экран плейлистов
  Promise.all([devPlaylists(), new Promise(r => splash(r))]).then(() => new Promise(r => askAppPin(r))).then(() => {
    $('pin-cover').classList.add('hidden');
    const on = Store.playlists().filter(p => !p.off);
    const last = Store.last();
    const lastPl = last && on.find(p => p.id === last.pl) || on[0];
    if (!lastPl) return openPlaylists();
    openGuide(lastPl, null, last && last.pl === lastPl.id);
  });
  window.LUPO_OK = true;   // программа запустилась (boot.js проверяет это для скачанных версий)
})();
