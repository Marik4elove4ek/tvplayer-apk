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
    // Видео видно только на экране просмотра (и в окошке телепрограммы); в настройках, списке плейлистов,
    // фильмах и других меню его не видно (звук продолжает идти)
    Player.hideVideo(name !== 'player');
    if (name !== 'player') wantAuto = false;   // ушли на другой экран — канал сам уже не включаем
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
        if (pl && pl.id === p.id) { pl = null; cancelPending(); Player.stop(); cur = -1; }
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
  function askExit(onNo) {
    ask(t('exit_q'), t('exit_app'), () => {
      Player.stop();
      try { if (window.tizen) tizen.application.getCurrentApplication().exit(); } catch (e) { }
      try { if (window.webOS) webOS.platformBack(); } catch (e) { }
      try { window.close(); } catch (e) { }
    }, onNo);
  }


  // ---------- Добавление и изменение плейлиста ----------
  let addType = 'm3u';
  function setType(type) {
    addType = type;
    document.querySelectorAll('#scr-add .tab').forEach(b => b.classList.toggle('on', b.dataset.type === type));
    $('f-m3u').classList.toggle('hidden', type !== 'm3u');
    $('f-xtream').classList.toggle('hidden', type !== 'xtream');
    // Куда переходит «Готово» на клавиатуре: имя → адрес (или сервер, логин, пароль) → программа → «Проверить»
    $('f-name').dataset.next = type === 'xtream' ? 'f-server' : 'f-url';
    $('f-url').dataset.next = 'f-epg';
    $('f-server').dataset.next = 'f-user';
    $('f-user').dataset.next = 'f-pass';
    $('f-pass').dataset.next = 'f-epg';
    $('f-epg').dataset.next = 'btn-check';
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
    // Курсор сразу на строке «Имя»; клавиатура сама не поднимается — только по OK на строке
    Nav.focus($('f-name').closest('.fbox'));
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
  let checkedOk = false;
  $('btn-check').onclick = async () => {
    checkedOk = false;
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
      checkedOk = true;
    } catch (e) {
      $('add-ok').classList.add('hidden');
      $('add-error').textContent = t('check_fail', errorText(e));
    } finally {
      $('btn-check').disabled = false;
      // Плейлист работает — курсор сразу на «Сохранить»; не работает — остаётся на «Проверить»
      Nav.focus(checkedOk ? $('btn-save') : $('btn-check'));
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
      Epg.forget(p.id);   // адрес могли изменить — программу скачаем заново
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
  // buttons — кнопки под текстом: [[название, действие], …] (например, в журнале: «Очистить» и «OK»)
  function doc(title, text, back, buttons) {
    const box = $('doc-btns');
    box.innerHTML = '';
    (buttons || []).forEach(([label, act], i) => {
      const b = document.createElement('button');
      b.className = 'btn' + (i === buttons.length - 1 ? ' primary' : '');
      b.textContent = label;
      b.onclick = () => { $('doc').classList.add('hidden'); act(); };
      box.appendChild(b);
    });
    box.classList.toggle('hidden', !box.children.length);
    $('doc-title').textContent = title;
    $('doc-text').textContent = text;
    $('doc-text').scrollTop = 0;
    $('doc').classList.remove('hidden');
    // Есть кнопки (журнал): курсор стоит на кнопках — ◀▶ между «Очистить» и «OK», а ▲▼ листают сам журнал
    Nav.setScope($('doc'), () => { $('doc').classList.add('hidden'); back(); }, box.children.length ? e => {
      if (e.keyCode !== 38 && e.keyCode !== 40) return false;
      const tx = $('doc-text');
      tx.scrollTop += (e.keyCode === 40 ? 1 : -1) * tx.clientHeight * 0.8;
      return true;
    } : null);
    Nav.focus(box.lastChild || $('doc-text'));
  }

  // ---------- Настройки: порядок как в Android (от главного к редкому) ----------
  const LANGS = [['en', 'English'], ['ru', 'Русский'], ['he', 'עברית'], ['fr', 'Français'], ['ar', 'العربية'],
    ['it', 'Italiano'], ['ja', '日本語'], ['ko', '한국어'], ['zh', '中文']];
  const VERSION = '0.61';
  // Если телевизор даёт странице не 1920 точек в ширину, вся страница уменьшается под экран — ничего не обрезается
  // Старый браузер телевизора не знает «gap» в строках (flex) — включаем запасные отступы (см. конец app.css)
  (function flexGap() {
    try {
      const d = document.createElement('div');
      d.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
      d.appendChild(document.createElement('div'));
      d.appendChild(document.createElement('div'));
      document.body.appendChild(d);
      if (d.scrollHeight !== 1) document.documentElement.classList.add('no-gap');
      d.remove();
    } catch (e) { }
  })();
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
      Player.native ? ['vol', t('st_volume_level'), t('legal_open'), () => doc(t('st_volume_level'), t(Player.lg ? 'volume_lg_note' : 'volume_tv_note'), again('vol'))]
        : ['vol', t('st_volume_level'), t(Store.leveler() ? 'on' : 'off'), () => { Store.saveLeveler(!Store.leveler()); applyLook(); openSettings('vol'); }],
      ['parental', t('st_parental'), t(Store.parental() ? 'on' : 'off'), () => chooseParental(again('parental'))],
      ['backup', t('set_backup'), t('st_backup_value'), () => pick(t('set_backup'), [{ label: t('backup_save') }, { label: t('backup_restore') }],
        // LG не даёт программам доступ к файлам — честно говорим об этом, а не «сохраняем» в никуда
        i => (Player.lg ? doc(t('set_backup'), t('backup_tv_none'), again('backup')) : i === 0 ? saveBackup() : restoreBackup()), again('backup'))],
      ['update', t('st_check_update'), t('settings_version', VERSION), () => checkUpdate(again('update'))],
      ['log', t('log_title'), t('st_exo_log_value', Store.log().length), () => {
        const l = Store.log();
        try { navigator.storage.estimate().then(u => { $('doc-title').textContent = t('log_title') + '   ·   ' + Math.round(u.usage / 1e6) + ' / ' + Math.round(u.quota / 1e6) + ' MB'; }); } catch (e) { }
        doc(t('log_title'), l.length ? l.join('\n\n') : t('log_empty'), again('log'),
          [[t('exo_log_clear'), () => { Store.clearLog(); toast(t('log_empty')); openSettings('log'); }], [t('ok'), again('log')]]);
      }],
      ['privacy', t('legal_privacy'), t('legal_open'), () => doc(t('legal_privacy'), t('legal_privacy_text') + '\n\n' + t('legal_privacy_extra') + '\n\n' + t('legal_privacy_extra2') + '\n\n' + t('legal_privacy_tv'), again('privacy'))],
      ['terms', t('legal_terms'), t('legal_open'), () => doc(t('legal_terms'), t('legal_terms_text') + '\n\n' + t('legal_terms_extra') + '\n\n' + t('legal_terms_extra2'), again('terms'))],
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
    // «Назад» из настроек — туда, откуда пришли (каналы или плейлисты)
    Nav.setScope($('scr-settings'), () => (settingsBack || toPlaylists)());
    Nav.focus(box.children[focusIdx || 0]);
  }
  // «Назад» из настроек в плейлисты: дальше «Назад» ведёт уже к каналам, а не снова в настройки
  function toPlaylists() { openPlaylists(undefined, null); }
  $('btn-settings').onclick = () => settingsGuard(() => openSettings(0, toPlaylists), () => openPlaylists());
  // При включённом «Скрыть 18+» настройки открываются только с PIN-кодом (как в Android)
  let settingsPassed = false;
  function settingsGuard(then, back) {
    if (!Store.parental() || settingsPassed) return then();
    checkPin(() => { settingsPassed = true; then(); }, back);
  }

  // ---------- Резервная копия (формат как в Android: плейлисты переносятся между приставкой и телевизором) ----------
  const WEB_PREFS = ['fav', 'audio', 'subs', 'view', 'barSec', 'transp', 'buffer'];
  // ---------- Автокопия ----------
  // Когда Лупо ставится заново с компьютера, телевизор стирает его память (плейлисты, избранное, настройки).
  // Поэтому после каждого изменения Лупо сам тихо кладёт копию в «Загрузки» телевизора (их переустановка не трогает),
  // а при запуске с пустой памятью возвращает всё из неё
  const AUTO = 'Lupo-Player-autosave.tvpb';
  let autoTimer = null;
  function autoKeys() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if ((k.startsWith('lupo.') && !/^lupo\.(ch\.|log$|last$)/.test(k)) || k === 'size') out[k] = localStorage.getItem(k);
    }
    return out;
  }
  async function autosaveNow() {
    clearTimeout(autoTimer);
    if (!Backup.onTv) return;
    try { Backup.save(AUTO, await Backup.pack({ app: 'lupo-auto', ls: autoKeys() })); }
    catch (e) { Store.addLog(new Date().toLocaleString(LANG) + ' — autosave\n' + (e && (e.message || e.name) || e)); }
  }
  window.LupoAutosave = () => {
    if (!Backup.onTv) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(autosaveNow, 4000);
  };
  function putAuto(d) { Object.keys(d.ls || {}).forEach(k => { try { localStorage.setItem(k, d.ls[k]); } catch (e) { } }); }
  async function autoRestore() {
    if (!Backup.onTv || Store.playlists().length) return false;
    try {
      const d = await Backup.unpack(new TextDecoder().decode(Backup.read('downloads/' + AUTO)));
      if (!d || d.app !== 'lupo-auto') return false;
      putAuto(d);
      return true;
    } catch (e) { return false; }
  }
  // Настройки для копии: всё, кроме того, что относится только к этому телевизору (выбор плеера для каналов и т. п.)
  const DEVICE_KEYS = /^lupo\.(webEngine|noVariant|noSplit|webReset|tight|playlists)$/;
  function backupKeys() { const o = autoKeys(); Object.keys(o).forEach(k => { if (DEVICE_KEYS.test(k)) delete o[k]; }); return o; }
  async function saveBackup() {
    try {
      const web = {};
      const getters = { fav: Store.favorites, audio: Store.audio, subs: Store.subs, view: Store.view, barSec: Store.barSec, transp: Store.transp, buffer: Store.buffer };
      WEB_PREFS.forEach(k => { web[k] = getters[k](); });
      const data = {
        playlists: Store.playlists().map(p => ({ id: p.id, name: p.name, type: p.type, url: p.url || '', server: p.server || '',
          user: p.user || '', pass: p.pass || '', epg: p.epg || '', vod: false })),
        // lupo_all — все настройки Лупо на телевизоре (свои названия, PIN-коды, замки, отключённые плейлисты, часы…);
        // Android-версия эту запись не читает и берёт только плейлисты
        prefs: { lupo_web: web, lupo_all: backupKeys(), lupo_off: Store.playlists().filter(p => p.off).map(p => p.id) },
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
      autosaveNow().then(() => setTimeout(() => location.reload(), 1200));
    }, back);
  }
  // Копия с Android-приставки: кроме плейлистов переносим избранное (в своём порядке), свои названия каналов,
  // каналы и папки под PIN-кодом, отключённые плейлисты и настройки (PIN-коды там зашифрованы — их задают заново)
  function importAndroid(prefs, list) {
    if (!prefs) return;
    const v = k => (prefs[k] ? prefs[k].v : undefined);
    const arr = k => { const x = v(k); if (Array.isArray(x)) return x; try { return JSON.parse(x || '[]'); } catch (e) { return []; } };
    const ids = list.map(p => p.id);
    let fav = arr('favlist_all');
    if (!fav.length) ids.forEach(id => arr('favlist_' + id).forEach(n => fav.push(id + '|' + n)));
    if (fav.length) Store.saveFavorites([...new Set(fav)]);
    const names = {};
    ids.forEach(id => { try { const m = JSON.parse(v('names_' + id) || '{}'); Object.keys(m).forEach(n => { names[id + '|' + n] = m[n]; }); } catch (e) { } });
    if (Object.keys(names).length) Store.saveRenames(names);
    const locked = [];
    ids.forEach(id => (v('locked_' + id) || []).forEach(n => locked.push(id + '|' + n)));
    if (locked.length) Store.saveLocked(locked);
    const lg = (v('locked_groups') || []).map(k => k.replace('\u0003', '|'));
    if (lg.length) Store.saveLockedGroups(lg);
    const off = v('disabled_playlists') || [];
    if (off.length) Store.savePlaylists(list.map(p => Object.assign(p, { off: off.includes(p.id) })));
    if (v('parental') !== undefined) Store.saveParental(!!v('parental'));
    if (['off', 'right', 'left'].includes(v('clock_pos'))) Store.saveClock(v('clock_pos'));
    if (v('clock_rainbow') !== undefined) Store.saveClockRainbow(!!v('clock_rainbow'));
    if (v('overlay_seconds')) Store.saveBarSec(+v('overlay_seconds'));
    if (v('transparency') !== undefined) Store.saveTransp(Math.max(0, Math.min(3, +v('transparency'))));
    if (v('channel_tiles') !== undefined) Store.saveView(v('channel_tiles') ? 'tiles' : 'rows');
    if (['small', 'medium', 'large'].includes(v('buffer'))) Store.saveBuffer(v('buffer'));
    if (v('audio_lang')) Store.saveAudio(v('audio_lang'));
    if (v('sub_lang')) Store.saveSubs(v('sub_lang'));
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
      // Копия с паролем (старые версии Android) — пароль вводится пультом (prompt() на телевизоре не работает)
      let pass = '';
      if (Backup.needsPassword(text)) {
        pass = await new Promise(res => inputDialog(t('backup_password'), '', true, x => { setTimeout(() => res(x), 0); }, () => res(null)));
        if (pass === null) { openSettings('backup'); return; }
      }
      const data = await Backup.unpack(text, pass);
      // Автокопия Лупо: возвращаем всё как было
      if (data && data.app === 'lupo-auto') { putAuto(data); toast(t('backup_restored')); autosaveNow().then(() => setTimeout(() => location.reload(), 1200)); return; }
      const list = (data.playlists || []).map(o => ({ id: String(o.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
        name: o.name || t('default_playlist_name'), type: o.type === 'xtream' ? 'xtream' : 'm3u',
        url: o.url || '', server: o.server || '', user: o.user || '', pass: o.pass || '', epg: o.epg || '' }));
      // «Заменить»: прежние названия, замки и избранное не остаются висеть на плейлистах из копии
      const all = data.prefs && data.prefs.lupo_all;
      // (язык, размер экрана и PIN-коды телевизора остаются, если в копии их нет)
      Object.keys(backupKeys()).forEach(k => { if (!/^(size|lupo\.(lang|pin|appPin|parental))$/.test(k)) { try { localStorage.removeItem(k); } catch (e) { } } });
      if (all) putAuto({ ls: all });
      const offIds = (data.prefs && data.prefs.lupo_off) || [];
      list.forEach(p => { if (offIds.includes(p.id)) p.off = true; });
      Store.savePlaylists(list);
      importAndroid(data.prefs && data.prefs.playlists, list);
      const web = data.prefs && data.prefs.lupo_web;
      if (web) {
        const setters = { fav: Store.saveFavorites, audio: Store.saveAudio, subs: Store.saveSubs, view: Store.saveView, barSec: Store.saveBarSec, transp: Store.saveTransp, buffer: Store.saveBuffer };
        WEB_PREFS.forEach(k => { if (k in web) setters[k](web[k]); });
      }
      const lang = (data.language || '').toLowerCase().split(/[-_,]/)[0].replace('iw', 'he');
      if (LANGS.some(l => l[0] === lang)) Store.saveLang(lang);
      Store.saveLast(null);
      toast(t('backup_restored'));
      autosaveNow().then(() => setTimeout(() => location.reload(), 1200));
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
  // Папка 18+ по названию ВСЕГДА под кодом, если PIN задан: замок не теряется при смене плейлиста,
  // переименовании папки или сбое сохранённого списка замков (снять вручную нельзя)
  function isAdultFolder(g) { return g !== FAV && g !== ALL && g !== GFAV && !!Store.pin() && isAdultName(g); }
  function isGroupLocked(g, pid) { return g !== FAV && g !== ALL && g !== GFAV && (Store.lockedGroups().includes(groupKey(g, pid)) || isAdultFolder(g)); }
  // Код 18+ действует 10 минут (как в Android): потом переключиться на другой закрытый канал — снова по коду.
  // Канал, который уже идёт, не прерывается (см. play: тот же канал код не спрашивает)
  const OPEN_MS = 10 * 60 * 1000;
  function timedSet() {
    const m = new Map();
    return {
      add(k) { m.set(k, Date.now()); },
      has(k) { const at = m.get(k); if (at === undefined) return false; if (Date.now() - at < OPEN_MS) return true; m.delete(k); return false; },
      delete(k) { m.delete(k); },
      clear() { m.clear(); }
    };
  }
  const unlockedGroups = timedSet();
  // Ушли в папку без замка — закрытые папки снова закрыты (вернуться — только по коду, даже через 2 минуты)
  function relockFolders() { unlockedGroups.clear(); }
  function openLockedGroup(g, pid, then, back) {
    if (!isGroupLocked(g, pid)) { relockFolders(); return then(); }
    if (unlockedGroups.has(groupKey(g, pid))) return then();
    checkPin(() => { unlockedGroups.add(groupKey(g, pid)); then(); }, back);
  }
  // Удерживать OK на папке — поставить или снять PIN-код
  function groupMenu(g, pid, back) {
    if (g === FAV || g === ALL || g === GFAV || isAdultFolder(g)) return back();
    const k = groupKey(g, pid);
    const on = isGroupLocked(g, pid);
    pick(groupLabel(g), [{ label: t(on ? 'unlock_group' : 'lock_group') }], () => {
      if (on) checkPin(() => { Store.saveLockedGroups(Store.lockedGroups().filter(x => x !== k)); toast(t('group_unlocked')); back(); }, back);
      else ensurePin(() => { Store.saveLockedGroups([...Store.lockedGroups(), k]); toast(t('group_locked_on')); back(); }, back);
    }, back);
  }
  function groupsOf(list) {
    return [FAV, ALL, ...new Set(list.map(c => c.group))];
  }
  function groupLabel(g) { return g === ALL ? t('group_all') : g === FAV ? t('group_fav') : g === GFAV ? t('group_fav') + ' · ' + t('all_playlists') : g; }
  // Общее избранное всех плейлистов: каналы берутся из сохранённых списков каждого плейлиста
  let gfavCache = null;
  function allFavorites() {
    // В том порядке, в котором избранное составлено (как в Android: общий список «плейлист|канал»)
    const f = Store.favorites();
    const want = new Set(f);
    const byKey = new Map();
    // Из больших плейлистов берём только каналы, которые есть в избранном (а не копируем десятки тысяч каналов)
    Store.playlists().filter(p => !p.off).forEach(p => {
      const mine = p.id === (pl && pl.id);
      const d = mine ? { channels } : Store.channels(p.id);
      ((d && d.channels) || []).forEach(c => {
        const k = p.id + '|' + c.name;
        if (!want.has(k) || byKey.has(k)) return;
        if (Store.parental() && (isAdultName(c.group) || isAdultName(c.name))) return;
        byKey.set(k, mine ? c : Object.assign({ _pl: p.id }, c));
      });
    });
    const out = f.map(k => byKey.get(k)).filter(Boolean);
    // Программа передач для каналов из других плейлистов
    new Set(out.map(c => c._pl).filter(Boolean)).forEach(pid => {
      const d = Store.channels(pid);
      if (d) Epg.ensure(pid, d.epg || [], d.channels);
    });
    return out;
  }
  // Канал по названию — одним действием (а не перебором всего плейлиста на каждый канал избранного)
  let nameMap = null, nameMapOf = null;
  function byName(list) {
    if (nameMapOf !== list) {
      nameMap = new Map();
      list.forEach(c => { if (!nameMap.has(c.name)) nameMap.set(c.name, c); });
      nameMapOf = list;
    }
    return nameMap;
  }
  function inGroup(g) {
    if (g === GFAV) return gfavCache = allFavorites();
    if (g === ALL) return channels;
    // Избранное — в своём порядке (его можно менять: «Переместить»)
    if (g === FAV) { const pre = pl.id + '|', m = byName(channels); return Store.favorites().filter(k => k.startsWith(pre)).map(k => m.get(k.slice(pre.length))).filter(Boolean); }
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
    if (!$('side').classList.contains('hidden')) [...$('side-list').children].forEach(el => { const p = el.querySelector('.ch-prog'), c = sideShown[el._i]; if (p && c) fillProg(p, c); });
    if (!$('bar').classList.contains('hidden') && cur >= 0) fillBar();
    if (!$('guide').classList.contains('hidden')) renderGuide();
  }
  // Программа нескольких плейлистов приходит одна за другой — перерисовываем не чаще раза в 2 секунды
  let progsTimer = null;
  Epg.onChange(() => { if (!progsTimer) progsTimer = setTimeout(() => { progsTimer = null; refreshProgs(); }, 2000); });
  setInterval(refreshProgs, 60000);

  // Плейлист: сохранённые каналы сразу, свежие — в фоне
  async function loadPlaylist(p, data) {
    pl = p;
    data = data || Store.channels(p.id);
    if (data) setChannels(data);
    else { channels = []; shown = []; }
    // Этот плейлист уже скачивается (сетку открыли ещё раз) — второй раз не качаем
    if (plLoading.has(p.id)) return;
    plLoading.add(p.id);
    try {
      const fresh = await M3U.load(p, t('no_group'), n => t('channel_n', n));
      Store.saveChannels(p.id, fresh);
      if (!pl || pl.id !== p.id) return;
      if (!data && !channels.length) {
        // Каналы скачаны впервые (сохранённых не было): включаем тот канал, на котором остановились, а не первый
        setChannels(fresh);
        const li = lastIndex();
        if (wantAuto && li >= 0 && screen === 'player' && !needsPin(shown[li])) { wantAuto = false; play(li); }
        else if (!$('guide').classList.contains('hidden')) { gi = Math.max(0, li); renderGuide(); if (jumped ? !Player.isPlaying() : (cur < 0 || !Player.isPlaying())) previewInGuide(gi); }
      }
      else { channels = noAdult(fresh.channels); setShown(inGroup(group)); Epg.open(pl.id, fresh.epg || [], channels); }
    } catch (e) {
      if (!data && pl && pl.id === p.id) toast(t('load_error', errorText(e)).split('\n')[0]);
    } finally { plLoading.delete(p.id); }
  }
  const plLoading = new Set();
  // Номер канала, на котором остановились в прошлый раз (в открытой папке), или −1
  let wantAuto = false;
  function lastIndex() {
    const last = Store.last();
    if (!last || !pl || last.pl !== pl.id || !last.name) return -1;
    let i = shown.findIndex(c => c.name === last.name && (!last.url || c.url === last.url));
    if (i < 0) i = shown.findIndex(c => c.name === last.name);
    return i;
  }
  function setChannels(data) {
    channels = noAdult(data.channels);
    Epg.open(pl.id, data.epg || [], channels);
    const last = Store.last();
    if (wantGroup && wantGroup.pl === pl.id) {
      // Папку выбрали в списке папок — открываем именно её, канал при этом не трогаем
      group = wantGroup.g === GFAV || wantGroup.g === FAV || wantGroup.g === ALL || groupsOf(channels).includes(wantGroup.g) ? wantGroup.g : ALL;
      wantGroup = null;
      if (group === FAV && !inGroup(FAV).length) group = ALL;
      setShown(inGroup(group));
      return;
    }
    group = last && last.pl === pl.id && (last.group === GFAV || groupsOf(channels).includes(last.group)) ? last.group : ALL;
    // Остановились в папке, где этого канала уже нет (например, убрали из избранного) — открываем «Все каналы»
    if (last && last.pl === pl.id && last.name && group !== ALL && !inGroup(group).some(c => c.name === last.name)) group = ALL;
    if (group === FAV && !inGroup(FAV).length) group = ALL;
    if (isGroupLocked(group) && !unlockedGroups.has(groupKey(group))) group = ALL;   // папка под PIN-кодом сама не открывается
    setShown(inGroup(group));
  }

  // ---------- Телепрограмма сеткой ----------
  const VIDEO_RECT = { x: 40, y: 30, w: 720, h: 405 };
  const ROWS = 7, WIN_MIN = 150, HALF = 30 * 60000;
  let gi = 0, gt = Date.now(), winStart = 0;
  function floorHalf(ms) { return Math.floor(ms / HALF) * HALF; }

  // autoplay — при старте программы сразу включить последний канал на весь экран
  function openGuide(p, data, autoplay) {
    if (!p) return openPlaylists(undefined, null);   // открытый плейлист удалён: «Назад» из плейлистов больше не ведёт в Настройки (не было круга)
    show('player');
    const fresh = !pl || pl.id !== p.id || data || !channels.length;
    if (fresh) loadPlaylist(p, data);
    if (fresh && pl && pl.id !== p.id) { if (!jumped) { cancelPending(); Player.stop(); } cur = -1; }
    const lastIdx = lastIndex();
    if (autoplay && lastIdx >= 0 && !needsPin(shown[lastIdx])) { play(lastIdx); return; }
    wantAuto = !!autoplay && !channels.length;   // каналы ещё скачиваются — включим последний канал, когда придут
    if (playingCh && cur < 0 && !jumped) {   // идущий канал из другой папки — открываем его папку
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
    if ((jumped ? !Player.isPlaying() : (cur < 0 || !Player.isPlaying())) && shown.length) previewInGuide(gi);
  }
  function closeGuide() {
    Radio.visible(true);
    $('guide').classList.add('hidden');
    $('drawer').classList.add('hidden');
    Player.setRect(null);
  }
  function guideScope() {
    if (Store.view() === 'tiles') {
      Nav.setScope($('g-tiles'), guideBack, tileKeys);
      if (!$('g-tiles').contains(document.activeElement)) Nav.focus(tileEl(gi));
    }
    else Nav.setScope($('guide'), guideBack, guideKeys);
  }
  // «Назад» в телепрограмме — папки и плейлисты; ещё «Назад» — меню; в меню «Назад» — вопрос о выходе (как в Android).
  // К каналу на весь экран — OK на канале
  function guideBack() { openDrawer(); }

  function renderGuide() {
    const tiles = Store.view() === 'tiles';
    $('guide').classList.toggle('tiles', tiles);
    $('guide').classList.toggle('playing', (cur >= 0 || !!playingCh) && Player.isPlaying());
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
    if (!c || needsPin(c)) return;   // канал под PIN-кодом в окне сам не включается
    if (c !== playingCh) { reconnects = []; clearTimeout(stallTimer); }
    if (i !== cur) prev = cur;
    cur = i;
    jumped = false;
    playingCh = c;
    notePlay(c);
    arch = null;
    if (Radio.looks(c)) { Radio.show(c, dispName(c)); Radio.visible(false); } else Radio.hide();
    startChannel(c, c.url);
    armRetry(c, c.url);
    Store.saveLast({ pl: pl.id, group, name: c.name, url: c.url });
  }
  function playFromGuide(i) {
    const p = focusedProg();
    if (p && p.e <= Date.now()) { playArchive(i, p); return; }
    if (p && p.s > Date.now()) return;   // будущая передача — пока только описание
    if (!shown[i]) return;
    if (i === cur && Player.isPlaying() && !arch) { closeGuide(); playerScope(); showBar(); return; }
    play(i);   // сетку закрывает сам показ — после PIN-кода (отмена PIN оставляет сетку на месте)
  }

  // Плитка поверх идущего видео: OK — смотреть; ◀ в первом столбце — папки и плейлисты
  function renderTiles() {
    const box = $('g-tiles');
    // На экране только «окно» из 240 плиток вокруг курсора: в плейлисте бывают десятки тысяч каналов,
    // и рисовать все сразу телевизору тяжело. Курсор подошёл к краю окна — окно сдвигается
    gi = Math.max(0, Math.min(gi, shown.length - 1));
    if (gi < tileFrom + 12 || gi >= tileFrom + TILE_WIN - 12 || tileFrom >= shown.length) tileFrom = Math.max(0, Math.floor((gi - TILE_WIN / 2) / 30) * 30);
    const was = document.activeElement;
    const off = was && was.parentNode === box ? was.offsetTop - box.scrollTop : null;
    box.innerHTML = '';
    $('g-tiles').classList.remove('hidden');
    shown.slice(tileFrom, tileFrom + TILE_WIN).forEach((c, k) => {
      const i = tileFrom + k;
      const el = document.createElement('div');
      el._i = i;
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
      el.addEventListener('focus', () => {
        gi = i;
        const n = Epg.now(c);
        fillInfo(c, n && n.cur);
        const edge = (i < tileFrom + 12 && tileFrom > 0) || (i >= tileFrom + TILE_WIN - 12 && tileFrom + TILE_WIN < shown.length);
        if (edge) setTimeout(() => { if (document.activeElement === el) renderTiles(); }, 0);
      });
      box.appendChild(el);
    });
    if (!shown.length) box.textContent = t('panel_empty');
    // Курсор ставим, только когда пульт сейчас на плитке (а не в папках, меню канала, поиске или вводе PIN-кода)
    if (Nav.scope() !== box) return;
    const el = tileEl(gi);
    Nav.focus(el);
    if (el && off != null) box.scrollTop = el.offsetTop - off;
  }
  const TILE_WIN = 240;
  let tileFrom = 0;
  function tileEl(i) { return $('g-tiles').children[i - tileFrom]; }
  function tileKeys(e) {
    const el = document.activeElement;
    const box = $('g-tiles');
    const idx = el && el.parentNode === box ? el._i : -1;
    if (digitKey(e)) return true;
    if (e.keyCode === 13 && idx >= 0) return holdOk(e, () => playFromGuide(idx), () => chMenu(shown[idx], () => { guideScope(); renderTiles(); }));
    // ◀ в крайнем левом столбце (столбцов бывает 5 или 6 — смотрим по месту на экране)
    if (e.keyCode === 37 && idx >= 0 && el.offsetLeft <= Math.min(...[...box.children].slice(0, 6).map(x => x.offsetLeft))) { gi = idx; openDrawer(); return true; }
    if ((e.keyCode === 70 || e.keyCode === 404 || e.keyCode === 405) && idx >= 0) {
      toggleFav(shown[idx]); el.querySelector('.tile-name').textContent = chName(shown[idx]); return true;
    }
    if (GUIDE_KEYS.includes(e.keyCode) && idx >= 0) { gi = idx; openSchedule(shown[idx], () => { guideScope(); renderTiles(); }); return true; }
    return false;
  }

  // ---------- Слева: папки и плейлисты; ещё левее — меню ----------
  // Дерево папок, как в Android: сверху общее избранное, дальше плейлисты по порядку. Открыт один плейлист
  // (▾) — под ним его «Избранное», «Все каналы» и папки; остальные свёрнуты (▸). OK на плейлисте — открыть/свернуть.
  // onPick(p, g) — выбрана папка g плейлиста p; isOn(pid, g) — эта папка сейчас выбрана
  function groupTree(box, expanded, onToggle, onPick, isOn) {
    box.innerHTML = '';
    const item = (label, cls, on, act, g, pid) => {
      const el = document.createElement('div');
      el.className = 'grp focusable' + (cls ? ' ' + cls : '') + (on ? ' on' : '');
      el.tabIndex = 0;
      el.textContent = label;
      el.onclick = act;
      el._g = g; el._pid = pid;
      box.appendChild(el);
      return el;
    };
    item('★ ' + t('group_fav').replace(/^★\s*/, '') + ' · ' + t('all_playlists'), '', isOn(null, GFAV), () => onPick(null, GFAV), GFAV, null);
    Store.playlists().filter(p => !p.off).forEach(p => {
      const open = p.id === expanded;
      item((open ? '▾  ' : '▸  ') + '📺 ' + p.name, 'pl-head', false, () => onToggle(open ? null : p.id, p.id));
      if (!open) return;
      const mine = pl && p.id === pl.id;
      const list = noAdult(mine ? channels : ((Store.channels(p.id) || {}).channels || []));
      const gs = [...new Set(list.map(c => c.group))];
      [FAV, ALL, ...gs.filter(g => !Store.parental() || !isAdultName(g))].forEach(g =>
        item(groupName(g, p.id), 'sub', isOn(p.id, g), () => onPick(p, g), g, p.id));
    });
  }
  // Папка другого плейлиста: переходим на этот плейлист и его папку
  // Идущий канал не останавливается и остаётся «последним», пока в новой папке не выбран другой канал
  let jumped = false;     // true, пока идёт канал прежней папки, а на экране уже другая
  let wantGroup = null;   // {pl, g} — какую папку открыть у плейлиста, на который перешли
  function openOtherPlaylist(p, g) {
    cur = -1;
    jumped = true;
    wantGroup = { pl: p.id, g };
    openGuide(p);
  }
  let drExpanded = null;
  function renderDrGroups(focusPid) {
    const box = $('dr-groups');
    groupTree(box, drExpanded, (id, pid) => { drExpanded = id; renderDrGroups(pid); },
      (p, g) => {
        if (!p) { relockFolders(); group = GFAV; setShown(inGroup(GFAV)); gi = Math.max(0, cur); closeDrawer(); renderGuide(); return; }
        openLockedGroup(g, p.id, () => {
          closeDrawer();
          if (pl && p.id === pl.id) { group = g; setShown(inGroup(g)); gi = Math.max(0, cur); renderGuide(); return; }
          openOtherPlaylist(p, g);
        }, () => { Nav.setScope($('drawer'), drawerBack, drawerKeys); openDrawer(); });
      },
      (pid, g) => (pid === null ? group === GFAV : pl && pid === pl.id && g === group));
    if (focusPid !== undefined) {
      const heads = [...box.querySelectorAll('.pl-head')];
      const idx = Store.playlists().filter(p => !p.off).findIndex(p => p.id === focusPid);
      if (heads[idx]) Nav.focus(heads[idx]);
    }
  }
  function openDrawer() {
    const box = $('dr-groups');
    drExpanded = pl ? pl.id : null;
    renderDrGroups();
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
    // Номер версии — внизу меню (раньше был внизу Настроек); пультом не выбирается
    const ver = document.createElement('div');
    ver.className = 'version dr-version';
    ver.textContent = t('settings_version', VERSION);
    menu.appendChild(ver);
    menu.classList.add('hidden');
    $('guide').classList.remove('with-menu'); shiftVideo();
    $('drawer').classList.remove('hidden');
    $('guide').classList.add('with-drawer'); shiftVideo();
    Nav.setScope($('drawer'), drawerBack, drawerKeys);
    Nav.focus(box.querySelector('.grp.on') || box.querySelector('.grp'));
  }
  function drawerKeys(e) {
    const el = document.activeElement;
    // Папки: на первой и последней строке курсор останавливается (по кругу ходит только список каналов) и
    // не перескакивает вбок в другую колонку
    if ((e.keyCode === 38 || e.keyCode === 40) && el && el.closest('#dr-groups')) {
      const list = [...$('dr-groups').querySelectorAll('.focusable')].filter(x => x.offsetParent !== null);
      const i = list.indexOf(el);
      const j = i + (e.keyCode === 40 ? 1 : -1);
      if (i >= 0) { if (j >= 0 && j < list.length) Nav.focus(list[j]); return true; }
    }
    const inMenu = el && el.closest('#dr-menu');
    // Меню (Поиск … Настройки): ▲▼ только внутри меню — на первом и последнем пункте курсор стоит на месте,
    // а не перескакивает вправо к папкам
    if (inMenu && (e.keyCode === 38 || e.keyCode === 40)) {
      const list = [...$('dr-menu').querySelectorAll('.grp')];
      const i = list.indexOf(el);
      const j = i + (e.keyCode === 40 ? 1 : -1);
      if (j >= 0 && j < list.length) Nav.focus(list[j]);
      return true;
    }
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
    const p0 = pl;   // плейлист, с которого начали: пока он качается, на экране могли открыть другой
    toast(t('refreshing'));
    try {
      const fresh = await M3U.load(p0, t('no_group'), n => t('channel_n', n));
      Store.saveChannels(p0.id, fresh);
      if (!pl || pl.id !== p0.id) { toast(t('refreshed')); return; }
      channels = noAdult(fresh.channels);
      setShown(inGroup(group));
      Epg.reload(p0.id, fresh.epg || [], channels);   // программа скачивается заново в фоне
      toast(t('refreshed'));
    } catch (e) { toast(t('refresh_failed', errorText(e))); }
    if (!pl || pl.id !== p0.id) return;
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
      el.onclick = () => {
        const go = () => { $('search').classList.add('hidden'); group = ALL; setShown(channels); prev = -1; play(i); };
        // Канал под PIN-кодом: сначала PIN (отмена оставляет поиск открытым), потом уже папка и показ
        if (!needsPin(c)) return go();
        const back = Nav.state();
        checkPin(() => { unlocked.add(favKey(c)); unlockedGroups.add(groupKey(c.group)); go(); }, back);
      };
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
  // ---------- Серверы провайдера (как в Android, SpeedTestActivity): во всех включённых плейлистах ----------
  // Запрос с пределом времени на всё: и на ответ, и на само скачивание (раньше зависшее скачивание держало тест вечно)
  function tget(u, ms, bin) {
    const ctl = window.AbortController ? new AbortController() : null;
    const lim = ms || 6000;
    let tm = null;
    const late = new Promise((_, rej) => { tm = setTimeout(() => { try { if (ctl) ctl.abort(); } catch (e) { } rej(new Error('timeout')); }, lim); });
    const work = fetch(u, ctl ? { cache: 'no-store', signal: ctl.signal } : { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return bin ? r : r.text().then(x => ({ text: x, url: r.url })); });
    return Promise.race([work, late]).then(v => { if (!bin) clearTimeout(tm); return v; }, e => { clearTimeout(tm); try { if (ctl) ctl.abort(); } catch (e2) { } throw e; });
  }
  // Список кусочков HLS: адрес списка и адреса кусочков (у главного списка — первое качество)
  async function hlsSegments(url) {
    let r = await tget(url, 6000);
    let base = r.url || url, text = r.text;
    if (/#EXT-X-STREAM-INF/.test(text)) {
      const lines = text.split(/\r?\n/);
      const i = lines.findIndex(l => l.startsWith('#EXT-X-STREAM-INF'));
      const uri = lines.slice(i + 1).find(x => x && !x.startsWith('#'));
      if (!uri) return null;
      base = new URL(uri.trim(), base).href;
      r = await tget(base, 6000);
      base = r.url || base; text = r.text;
    }
    const segs = text.split(/\r?\n/).filter(l => l && !l.startsWith('#')).map(l => new URL(l.trim(), base).href);
    return segs.length ? { list: base, segs } : null;
  }
  async function findServers(stop) {
    const found = new Map();
    const t0 = Date.now();
    for (const p of Store.playlists().filter(x => !x.off)) {
      const d = pl && pl.id === p.id ? { channels } : Store.channels(p.id);
      const live = ((d && d.channels) || []).filter(c => /^http/i.test(c.url) && !/\.(mp3|aac|mp4|mkv)(\?|$)/i.test(c.url));
      if (!live.length) continue;
      // Каналы с разных «входных» серверов и из разных мест списка
      const samples = [], hosts = new Set(), domains = new Set();
      live.forEach(c => { try { const h = new URL(c.url).host; if (!hosts.has(h) && samples.length < 6) { hosts.add(h); samples.push(c); } } catch (e) { } });
      live.slice(0, 400).forEach(c => { try { domains.add(new URL(c.url).host.split('.').slice(-2).join('.')); } catch (e) { } });
      const mixed = domains.size > 8;   // открытые каналы с десятков сайтов — одна строка на плейлист
      const step = Math.max(1, Math.floor(live.length / 8));
      for (let i = Math.floor(step / 2); i < live.length && samples.length < 12; i += step) if (!samples.includes(live[i])) samples.push(live[i]);
      let perList = 0;
      for (const c of samples) {
        if (stop() || found.size >= 8 || perList >= (mixed ? 1 : 4) || Date.now() - t0 > 25000) break;
        try {
          let srv = null;
          if (/m3u8/i.test(c.url)) {
            const seg = await hlsSegments(c.url);
            if (seg) srv = { host: new URL(seg.segs[seg.segs.length - 1]).host, url: seg.list, hls: true };
          }
          if (!srv) {
            // Непрерывный поток: куда привели пересылки
            const ctl = new AbortController();
            const r = await Promise.race([fetch(c.url, { signal: ctl.signal }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))]);
            try { ctl.abort(); } catch (e) { }
            srv = { host: new URL(r.url || c.url).host, url: r.url || c.url, hls: false };
          }
          if (!found.has(srv.host)) { found.set(srv.host, Object.assign(srv, { playlist: p.name })); perList++; }
        } catch (e) { }
      }
    }
    return [...found.values()];
  }
  // Страна, город и владелец сервера: адрес через DNS Google, место — через ipwho.is
  const where = new Map();
  async function serverPlace(host) {
    if (where.has(host)) return where.get(host);
    let out = { place: '', owner: '' };
    try {
      let ip = host.replace(/:\d+$/, '');
      if (!/^[\d.]+$/.test(ip)) {
        const dns = JSON.parse((await tget('https://dns.google/resolve?name=' + encodeURIComponent(ip) + '&type=A', 5000)).text);
        const a = (dns.Answer || []).find(x => x.type === 1);
        ip = a ? a.data : '';
      }
      if (ip) {
        const o = JSON.parse((await tget('https://ipwho.is/' + ip + '?fields=success,country_code,city,connection', 5000)).text);
        const code = (o.country_code || '').toUpperCase();
        if (/^[A-Z]{2}$/.test(code)) {
          const flag = String.fromCodePoint(0x1F1E6 + code.charCodeAt(0) - 65, 0x1F1E6 + code.charCodeAt(1) - 65);
          let name = code;
          try { name = new Intl.DisplayNames([LANG], { type: 'region' }).of(code); } catch (e) { }
          out.place = flag + ' ' + name + (o.city ? ', ' + o.city : '');
        }
        const c = o.connection || {};
        out.owner = String(c.org || c.isp || '').slice(0, 40);
      }
    } catch (e) { }
    where.set(host, out);
    return out;
  }
  // Пинг и джиттер (три коротких запроса), скорость — по настоящим кусочкам эфира (~8 с) или потоку (5 с)
  async function measureServer(sv, stop) {
    const times = [];
    for (let j = 0; j < 3; j++) {
      const s0 = performance.now();
      try { await tget(sv.hls ? sv.url : 'http://' + sv.host + '/', 6000); } catch (e) { }
      times.push(performance.now() - s0);
    }
    times.sort((a, b) => a - b);
    let bytes = 0, ms = 0, atLeast = false;
    const t0 = performance.now();
    try {
      if (sv.hls) {
        const done = new Set();
        while (!stop() && performance.now() - t0 < 12000 && ms < 8000) {
          const seg = await hlsSegments(sv.url);
          const fresh = seg ? seg.segs.slice(-6).filter(u => !done.has(u)) : [];
          if (!fresh.length) { await new Promise(r => setTimeout(r, 700)); if (!seg) break; continue; }
          for (const u of fresh) {
            if (stop() || performance.now() - t0 > 12000) break;
            done.add(u);
            const s0 = performance.now();
            const r = await tget(u, 10000, true);
            bytes += (await r.arrayBuffer()).byteLength;
            ms += performance.now() - s0;
            gauge(bytes * 8 / (ms / 1000) / 1e6);
          }
        }
      } else {
        const ctl = new AbortController();
        // Поток молчит (ни ответа, ни данных) — через 12 с обрываем, чтобы тест шёл дальше
        const guard = setTimeout(() => { try { ctl.abort(); } catch (e) { } }, 12000);
        const r = await fetch(sv.url, { signal: ctl.signal });
        const rd = r.body.getReader();
        const s0 = performance.now();
        while (!stop() && performance.now() - s0 < 5000) {
          const { done, value } = await rd.read();
          if (done) break;
          bytes += value.byteLength;
          gauge(bytes * 8 / ((performance.now() - s0) / 1000) / 1e6);
        }
        ms = performance.now() - s0;
        clearTimeout(guard);
        try { ctl.abort(); } catch (e) { }
        atLeast = true;   // живой поток идёт с его собственной скоростью — сервер может больше
      }
    } catch (e) { }
    return { ping: times[0] > 5900 ? 0 : Math.round(times[0]), jitter: Math.round(times[2] - times[0]),
      mbps: ms > 0 && bytes > 0 ? bytes * 8 / (ms / 1000) / 1e6 : 0, atLeast };
  }
  // Оценка по цвету (выбор Марка): скорость меньше 50 Мбит/с — красная, 50–70 — жёлтая, от 70 — зелёная.
  // Пинг и джиттер — наоборот, чем меньше, тем лучше: пинг до 50 мс — зелёный, до 100 — жёлтый, больше — красный;
  // джиттер до 10 мс — зелёный, до 30 — жёлтый, больше — красный
  const SP_COL = { good: '#3EE08F', mid: '#FFC94D', bad: '#FF5A5F' };
  function speedGrade(mbps) { return mbps >= 70 ? 'good' : mbps >= 50 ? 'mid' : 'bad'; }
  function pingGrade(ms) { return ms <= 50 ? 'good' : ms <= 100 ? 'mid' : 'bad'; }
  function jitGrade(ms) { return ms <= 10 ? 'good' : ms <= 30 ? 'mid' : 'bad'; }
  function grade(el, g) { el.classList.remove('sp-good', 'sp-mid', 'sp-bad'); if (g) el.classList.add('sp-' + g); }
  function gauge(mbps) {
    const max = mbps > 1000 ? 2500 : mbps > 500 ? 1000 : 500;
    const f = Math.min(1, mbps / max);
    $('sp-num').textContent = Math.round(mbps);
    $('sp-max').textContent = max + '+';
    $('sp-arc').style.strokeDashoffset = 960 * (1 - f);
    // Стрелка: от начала шкалы (внизу слева) по дуге 239° до конца (внизу справа)
    $('sp-needle').setAttribute('transform', 'rotate(' + (239.2 * f).toFixed(1) + ' 320 306)');
    $('speed').style.setProperty('--sp-c', mbps > 0 ? SP_COL[speedGrade(mbps)] : '#7B5CFF');
  }
  async function speedTest() {
    const back = Nav.state();
    $('speed').classList.remove('hidden');
    $('sp-ping-l').textContent = t('speed_ping', '').replace(/[\d\s]*мс|ms/i, '').trim() || 'ping';
    $('sp-jit-l').textContent = t('speed_jitter', '').replace(/[\d\s]*мс|ms/i, '').trim() || 'jitter';
    $('sp-status').textContent = t('speed_hint');
    ['sp-ping', 'sp-jit', 'sp-hd'].forEach(id => grade($(id), null));
    gauge(0);
    const box = $('sp-servers');
    box.innerHTML = '';
    let run = 0;
    const close = () => { $('speed').classList.add('hidden'); back(); };
    Nav.setScope($('speed'), close);
    Nav.focus($('sp-btn'));
    $('sp-btn').onclick = async () => {
      $('sp-btn').disabled = true;
      try {
        $('sp-status').textContent = t('speed_measuring', 'Cloudflare');
        const pings = [];
        for (let i = 0; i < 6; i++) { const t0 = performance.now(); await xhr('https://speed.cloudflare.com/__down?bytes=0'); pings.push(performance.now() - t0); }
        const jit = pings.slice(1).reduce((a, p, i) => a + Math.abs(p - pings[i]), 0) / (pings.length - 1);
        const pingMs = Math.round(Math.min(...pings)), jitMs = Math.round(jit);
        $('sp-ping').textContent = pingMs + ' ms';
        $('sp-jit').textContent = jitMs + ' ms';
        grade($('sp-ping'), pingGrade(pingMs));
        grade($('sp-jit'), jitGrade(jitMs));
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
        grade($('sp-hd'), mb >= 25 ? 'good' : mb >= 8 ? 'mid' : 'bad');
        // Серверы провайдера во всех включённых плейлистах: страна, город, владелец, скорость, пинг, джиттер
        const my = ++run;
        const stop = () => my !== run || $('speed').classList.contains('hidden');
        gauge(0);
        $('sp-status').textContent = t('speed_finding');
        box.innerHTML = '';
        const servers = await findServers(stop);
        if (!servers.length) box.textContent = t('speed_no_servers');
        const rows = servers.map(sv => {
          const row = document.createElement('div');
          row.className = 'sp-row focusable';
          row.tabIndex = 0;
          row.innerHTML = '<div><div class="n"></div><div class="h"></div></div><div class="v"></div><div class="h"></div><div class="h"></div>';
          row.querySelector('.n').textContent = sv.playlist;
          row.querySelector('.h').textContent = sv.host;
          row.children[1].textContent = t('speed_wait');
          box.appendChild(row);
          return row;
        });
        let bestName = '', bestSpeed = 0;
        for (let i = 0; i < servers.length && !stop(); i++) {
          const sv = servers[i], row = rows[i];
          const pl2 = await serverPlace(sv.host);
          const label = pl2.place ? sv.playlist + ' — ' + pl2.place : sv.playlist;
          row.querySelector('.n').textContent = label;
          row.querySelector('.h').textContent = pl2.owner ? pl2.owner + '  ·  ' + sv.host : sv.host;
          $('sp-status').textContent = t('speed_measuring', label);
          gauge(0);
          const r = await measureServer(sv, stop);
          row.children[1].textContent = r.mbps > 0 ? (r.atLeast ? '≥ ' : '') + (r.mbps >= 10 ? Math.round(r.mbps) : r.mbps.toFixed(1)) + ' ' + t('speed_unit') : t('speed_failed');
          row.children[2].textContent = r.ping ? t('speed_ping', r.ping) : '';
          row.children[3].textContent = r.ping ? t('speed_jitter', r.jitter) : '';
          grade(row.children[1], r.mbps > 0 && !r.atLeast ? speedGrade(r.mbps) : r.atLeast && r.mbps >= 70 ? 'good' : null);
          grade(row.children[2], r.ping ? pingGrade(r.ping) : null);
          grade(row.children[3], r.ping ? jitGrade(r.jitter) : null);
          if (!r.atLeast && r.mbps > bestSpeed) { bestSpeed = r.mbps; bestName = label; }
          if (!(r.mbps > 0)) Store.addLog(new Date().toLocaleString(LANG) + ' — speed test\n' + sv.playlist + ' (' + sv.host + ')');
        }
        gauge(mb);
        if (servers.length > 1 && bestSpeed > 0) $('sp-status').textContent = t('speed_best', bestName);
        else
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
  // password === 'pin' — PIN-код: своя цифровая панель (пульт или цифры на пульте), клавиатура телевизора не открывается.
  // pinLen — длина уже заданного кода: набрали столько цифр — проверка сама, без «OK»
  function inputDialog(title, value, password, onOk, onCancel, pinLen) {
    const pinMode = password === 'pin';
    $('input').classList.toggle('pin-mode', pinMode);
    $('pin-dots').classList.toggle('hidden', !pinMode);
    $('pin-pad').classList.toggle('hidden', !pinMode);
    if (pinMode) return pinDialog(title, onOk, onCancel, pinLen);
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
  function pinDialog(title, onOk, onCancel, pinLen) {
    $('input-title').textContent = title;
    $('input-error').textContent = '';
    let code = '';
    const dots = $('pin-dots'), pad = $('pin-pad');
    const draw = () => {
      dots.innerHTML = '';
      for (let i = 0; i < Math.max(pinLen || 4, code.length); i++) {
        const d = document.createElement('span');
        if (i < code.length) d.className = 'on';
        dots.appendChild(d);
      }
    };
    const close = () => { $('input').classList.add('hidden'); $('input').classList.remove('pin-mode'); };
    const submit = () => {
      if (!code) return;
      const v = code;
      const r = onOk(v, msg => { $('input-error').textContent = msg; code = ''; draw(); });
      if (r !== false) close();
    };
    const add = d => {
      if (code.length >= 12) return;
      code += d;
      $('input-error').textContent = '';
      draw();
      if (pinLen && code.length === pinLen) setTimeout(submit, 150);
    };
    pad.innerHTML = '';
    let five = null;
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].forEach(k => {
      const b = document.createElement('button');
      b.className = 'pin-key' + (k === 'ok' ? ' ok' : '');
      b.textContent = k === 'del' ? '←' : k === 'ok' ? 'OK' : k;
      b.onclick = () => {
        if (k === 'del') { code = code.slice(0, -1); draw(); }
        else if (k === 'ok') submit();
        else add(k);
      };
      if (k === '5') five = b;
      pad.appendChild(b);
    });
    draw();
    $('input-cancel').onclick = () => { close(); if (onCancel) onCancel(); };
    $('input').classList.remove('hidden');
    // Цифры на пульте тоже набирают код
    Nav.setScope($('input'), () => { close(); if (onCancel) onCancel(); }, e => {
      const k = e.keyCode;
      const d = k >= 48 && k <= 57 ? k - 48 : k >= 96 && k <= 105 ? k - 96 : -1;
      if (d < 0) return false;
      add(String(d));
      return true;
    });
    Nav.focus(five);
  }
  // PIN нет — сначала задать (от 4 цифр); есть — спросить
  function ensurePin(then, back) {
    if (Store.pin()) return then();
    inputDialog(t('pin_new'), '', 'pin', (v, err) => {
      if (!/^\d{4}$/.test(v)) { err(t('pin_new')); return false; }
      Store.savePin(v);
      setTimeout(then, 0);
    }, back, 4);
  }
  let pinFails = 0, pinLockUntil = 0;
  function checkPin(then, back) {
    if (!Store.pin()) return then();
    inputDialog(t('pin_enter'), '', 'pin', (v, err) => {
      // Подбор кода: после пяти неверных попыток подряд — минута ожидания
      if (Date.now() < pinLockUntil) { err(t('pin_wait', Math.ceil((pinLockUntil - Date.now()) / 1000))); return false; }
      if (v !== Store.pin()) {
        if (++pinFails >= 5) { pinFails = 0; pinLockUntil = Date.now() + 60000; err(t('pin_wait', 60)); }
        else err(t('pin_wrong'));
        return false;
      }
      pinFails = 0;
      setTimeout(then, 0);
    }, back, Store.pin().length);
  }

  // ---------- Меню канала (удерживать OK на канале): избранное, переместить, переименовать, PIN ----------
  function chMenu(c, back, opts) {
    const items = [];
    // Список каналов поверх видео (◀): как раньше — смотреть рядом, избранное, звук, субтитры, PIN-код
    if (opts && opts.split && canSplit() && c !== shown[cur]) items.push({ label: t('split_watch'), act: () => opts.split() });
    items.push({ label: t(isFav(c) ? 'info_fav_remove' : 'info_fav_add'), act: () => { toggleFav(c); back(); } });
    if (opts && opts.tracks) {
      items.push({ label: t('audio_track'), act: () => { closeSide(); openAudioMenu(); } });
      items.push({ label: t('choose_subtitles'), act: () => { closeSide(); openSubsMenu(); } });
    }
    if (opts && opts.move && isFav(c)) items.push({ label: t('move'), act: () => opts.move() });
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
  function digitKey(e, onNum) {
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
      if (n < 1) return;
      if (onNum) return onNum(n);
      if (n <= shown.length) play(n - 1);
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
    // Двойной OK на видео: программа посередине экрана (а не сбоку)
    $('sched').classList.add('center');
    $('sched').classList.remove('hidden');
    Nav.setScope($('sched'), () => { $('sched').classList.add('hidden'); $('sched').classList.remove('center'); playerScope(); });
    Nav.focus(box.querySelector('.focusable'));
  }
  // Список каналов (◀) и программа поверх видео сами уходят через минуту, если пультом ничего не нажимали
  let panelIdle = null;
  function armPanelIdle() {
    clearTimeout(panelIdle);
    panelIdle = setTimeout(() => {
      if (screen !== 'player' || !$('guide').classList.contains('hidden')) return;
      // Список закрываем, только если пульт сейчас в нём: поверх может быть открыто меню канала, PIN или
      // переименование — их нельзя оставлять на экране без пульта
      if (!$('side').classList.contains('hidden') && !moving && !splitPending && Nav.scope() === $('side')) closeSide();
      if (!$('sched').classList.contains('hidden') && Nav.scope() === $('sched')) { $('sched').classList.add('hidden'); $('sched').classList.remove('center'); playerScope(); }
    }, 60000);
  }
  document.addEventListener('keydown', armPanelIdle, true);
  // Меню на видео (удерживать OK): смотреть рядом, звук, субтитры, программа
  function playerMenu() {
    const c = shown[cur];
    // Порядок как просил Марк: смотреть рядом, размер экрана, программа, звук, субтитры. Меню — посередине экрана
    const items = [
      ...(canSplit() ? [{ label: t('split_watch'), act: () => splitPick() }] : []),
      { label: t('size_title'), act: () => sizeMenu(playerScope) },
      { label: t('schedule_title'), act: () => c && openSchedule(c, playerScope) },
      { label: t('audio_track'), act: openAudioMenu },
      { label: t('choose_subtitles'), act: openSubsMenu }
    ];
    $('pick').classList.add('center');
    pick(dispName(c), items.map(i => ({ label: i.label })), i => items[i].act(), playerScope);
  }

  // ---------- Фильмы и сериалы (Xtream Codes), как в Android (Vod.kt, VodActivity.kt) ----------
  let vodPl = null, vodKind = 'movie', vodList = null, vodCat = null, vodQuery = '', vodItems = [], vodShownN = 0;
  let vodCache = null;   // последний загруженный раздел {key, at, list}
  let vodReq = 0, vodFrom = null;   // номер запроса к серверу (ответ после ухода с экрана не нужен); постер, с которого открыли фильм
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
    const my = ++vodReq;
    cancelPending();
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
      if (my !== vodReq || screen !== 'vod') return;
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
    if (my !== vodReq || screen !== 'vod') return;   // пока каталог скачивался, с экрана ушли
    vodCat = null; vodQuery = ''; vodExp = null;
    vodRenderCats();
    vodShowItems();
    Nav.setScope($('scr-vod'), vodBack, vodKeys);
    Nav.focus($('vod-cats').children[1] || $('vod-cats').firstChild);
  }
  function vodStatus(text) { const s = $('vod-status'); s.textContent = text || ''; s.classList.toggle('hidden', !text); }
  function vodRenderCats() {
    const box = $('vod-cats');
    box.innerHTML = '';
    const add = (label, on, act, key) => {
      const el = document.createElement('div');
      el.className = 'grp focusable' + (on ? ' on' : '');
      el.tabIndex = 0;
      el.textContent = label;
      el.onclick = act;
      el._key = key || '';
      box.appendChild(el);
    };
    add('🔍  ' + t('vod_search') + (vodQuery ? ': ' + vodQuery : ''), !!vodQuery, () => inputDialog(t('vod_search'), vodQuery, false, v => {
      vodQuery = v; vodCat = null;
      setTimeout(() => { vodRenderCats(); vodShowItems(); Nav.setScope($('scr-vod'), vodBack, vodKeys); Nav.focus($('vod-grid').firstChild || $('vod-cats').firstChild); }, 0);
    }, () => { Nav.setScope($('scr-vod'), vodBack, vodKeys); Nav.focus($('vod-cats').firstChild); }));
    add(t('vod_all') + '  (' + vodList.items.length + ')', vodCat === null && !vodQuery, () => vodPickCat(null), 'all');
    // Как в Android: категории вида «Сериалы | Боевик» собраны в разделы — сначала «Сериалы», внутри «Боевик».
    // Раздел раскрывается по OK; раскрыт один раздел
    const pre = c => { const i = c.name.indexOf('|'); return i > 0 ? c.name.slice(0, i).trim() : ''; };
    const cnt = {};
    vodList.cats.forEach(c => { const p = pre(c); if (p) cnt[p] = (cnt[p] || 0) + 1; });
    const num = {};
    vodList.items.forEach(x => { num[x.cat] = (num[x.cat] || 0) + 1; });
    const seen = {};
    vodList.cats.forEach(c => {
      const p = pre(c);
      if (!p || cnt[p] < 2) { add(c.name + '  (' + (num[c.id] || 0) + ')', vodCat === c.id, () => vodPickCat(c.id), 'c' + c.id); return; }
      if (seen[p]) return;
      seen[p] = true;
      const subs = vodList.cats.filter(z => pre(z) === p);
      const open = vodExp === p;
      add((open ? '▾  ' : '▸  ') + p + '  (' + subs.reduce((n, z) => n + (num[z.id] || 0), 0) + ')', false, () => { vodExp = open ? null : p; vodRenderCats(); vodFocusCat('s' + p); }, 's' + p);
      if (open) subs.forEach(z => add('      ' + z.name.slice(z.name.indexOf('|') + 1).trim() + '  (' + (num[z.id] || 0) + ')', vodCat === z.id, () => vodPickCat(z.id), 'c' + z.id));
    });
  }
  let vodExp = null;   // какой раздел категорий раскрыт
  function vodFocusCat(key) {
    const el = [...$('vod-cats').children].find(e => e._key === key);
    Nav.focus(el || $('vod-cats').children[1] || $('vod-cats').firstChild);
  }
  function vodPickCat(id) {
    vodCat = id; vodQuery = '';
    vodRenderCats();
    vodShowItems();
    vodFocusCat(id === null ? 'all' : 'c' + id);
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
    vodReq++;
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
    const my = ++vodReq;
    vodFrom = from;
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
      if (my !== vodReq || screen !== 'vod') return;
      vodStatus('');
      doc(x.name, e.message || String(e), () => { Nav.setScope($('scr-vod'), vodBack, vodKeys); Nav.focus(from); });
      return;
    }
    if (my !== vodReq || screen !== 'vod') return;   // ответ пришёл, когда с экрана уже ушли или открыли другой фильм
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
    const epIds = episodes.map(e => e.id);
    const infoBack = () => { $('vodinfo').classList.add('hidden'); Nav.setScope($('scr-vod'), vodBack, vodKeys); Nav.focus(from); };
    // Серию уже начинали смотреть — спрашиваем: продолжить с того места или начать сначала
    const playEp = j => {
      const at = vodPos(urls[j]);
      if (!(at > 0)) return vodPlay(x, urls, titles, j, epIds, 0);
      pick(titles[j], [{ label: t('vod_resume', timeText(at)) }, { label: t('vod_from_start') }],
        k => vodPlay(x, urls, titles, j, epIds, k === 0 ? at : 0),
        () => { Nav.setScope($('vodinfo'), infoBack); Nav.focus($('vi-list').firstChild); });
    };
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
    cancelPending();
    $('pl-spinner').classList.remove('hidden');
    if (v.epIds) try { localStorage.setItem('vodlast.' + vodPl.id + '.' + v.item.id, v.epIds[v.idx]); } catch (e) { }
    Player.start(v.urls[v.idx]);
    v.seekDone = !(v.at > 0);
    vodBar();
  }
  // Показ пошёл — перематываем туда, где остановились
  Player.on('playing', () => { if (vod && !vod.seekDone) { vod.seekDone = true; setTimeout(() => { if (vod) Player.seekTo(vod.at); }, 300); } });
  // Раз в 10 секунд запоминаем место
  setInterval(() => {
    if (!vod || screen !== 'player' || !Player.isPlaying()) return;
    const p = Player.pos(), d = Player.duration();
    if (p > 0) setVodPos(vod.urls[vod.idx], d > 0 && p > d - 120000 ? 0 : p);
  }, 10000);
  function vodBar(keep) {
    if (!vod) return;
    const p = Player.pos(), d = Player.duration();
    $('bar-name').textContent = vod.titles[vod.idx];
    $('bar-group').textContent = '';
    $('bar-num').textContent = vod.epIds ? '' : '🎬';
    $('bar-logo').classList.add('hidden');
    $('bar-prog').textContent = (Player.isPaused() ? '⏸  ' : '▶  ') + timeText(p) + (d > 0 ? '  /  ' + timeText(d) : '');
    $('bar-next').textContent = ''; $('bar-next2').textContent = '';
    $('bar-left').textContent = d > 0 ? '−' + timeText(Math.max(0, d - p)) : '';
    $('bar-fill').style.width = d > 0 ? Math.round(100 * p / d) + '%' : '0';
    $('bar-bubbles').innerHTML = '';
    // keep — только обновить цифры на уже открытой плашке (раз в секунду), не продлевая её показ
    if (keep) return;
    $('bar').classList.remove('hidden');
    clearTimeout(barTimer);
    barTimer = setTimeout(() => $('bar').classList.add('hidden'), Store.barSec() * 1000);
  }
  setInterval(() => { if (vod && !$('bar').classList.contains('hidden')) vodBar(true); }, 1000);
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
      { label: t('size_title'), act: () => sizeMenu(vodScope) },
      { label: t('audio_track'), act: openAudioMenu },
      { label: t('choose_subtitles'), act: openSubsMenu }
    ];
    $('pick').classList.add('center');
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
    Nav.focus((vodFrom && vodFrom.isConnected && vodFrom) || $('vod-grid').querySelector('.vod-item') || $('vod-cats').firstChild);
  }

  // ---------- Смотреть рядом: два канала на экране ----------
  // Второй канал выбирается в обычном списке слева (как по «влево»). ▲▼ — другой канал справа,
  // OK — правый канал на весь экран, «Назад» — левый на весь экран
  let split = -1;            // −1 — обычный просмотр; иначе номер второго канала в splitList
  let splitList = [], splitPending = false, splitMode = 'multiview';
  function splitPick() {
    splitPending = true;
    openSide();
    toast(t('split_pick'));
  }
  function splitStart(list, j, mode) {
    splitList = list;
    split = (j + list.length) % list.length;
    splitMode = mode || 'multiview';
    cancelPending();
    Radio.hide();
    $('bar').classList.add('hidden');
    Player.split(streamUrl(shown[cur]), splitList[split].url, splitMode);
    Nav.setScope($('scr-player'), splitEnd, splitKeys);
    toast(dispName(shown[cur]) + '  |  ' + dispName(splitList[split]));
    // Через 9 с проверяем правую половину: время в ней должно идти. Не идёт — другой способ; оба способа
    // не дали картинку — записываем в журнал, что ответил телевизор
    clearTimeout(splitCheck);
    const my = ++splitRun;
    splitCheck = setTimeout(() => {
      if (my !== splitRun || split < 0) return;
      const st = Player.splitState();
      const right = st.find(x => x.i === 1);
      const left = st.find(x => x.i === 0);
      const good = x => x && x.time > 500 && (x.web ? x.pic !== false : x.state === 'PLAYING');
      const ok = good(right) && good(left);
      Store.addNote(new Date().toLocaleString(LANG) + ' — ' + t('split_watch') + ' (' + splitMode + ')\n' + JSON.stringify(st));
      if (ok) return;
      splitGiveUp();
    }, 9000);
  }
  let splitCheck = null, splitRun = 0;
  function splitKeys(e) {
    const k = e.keyCode;
    if (k === 38 || k === 427 || k === 40 || k === 428) {
      let j = split;
      // Листание второй половины: свой же канал и каналы под PIN-кодом пропускаются
      let guard = splitList.length;
      do { j = (j + (k === 38 || k === 427 ? 1 : -1) + splitList.length) % splitList.length; } while (guard-- > 0 && (splitList[j] === shown[cur] || needsPin(splitList[j])) && splitList.length > 1);
      if (needsPin(splitList[j])) return true;
      splitStart(splitList, j, splitMode);
      return true;
    }
    if (k === 13) {
      const c = splitList[split];
      clearTimeout(splitCheck); splitRun++;
      split = -1;
      Player.splitStop();
      playerScope();
      let i = shown.indexOf(c);
      if (i < 0) { setShown(splitList); group = sideGroup; i = shown.indexOf(c); }
      play(i);
      return true;
    }
    return ![27, 8, 10009, 461].includes(k);   // «Назад» — к обычному просмотру
  }
  function splitEnd() { clearTimeout(splitCheck); splitRun++; split = -1; Player.splitStop(); playerScope(); play(cur); }
  // Второй видеоресурс телевизор не дал — пробуем правый канал через браузерный плеер; не вышло и так — сообщаем
  Player.on('splitError', e => {
    if (split < 0) return;
    Store.addLog(new Date().toLocaleString(LANG) + ' — ' + t('split_watch') + ' (' + splitMode + ')\n' + (e && e.msg || e));
    splitGiveUp();
  });
  // Способ не дал двух картинок: пробуем следующий; не вышел ни один — этот телевизор два видео сразу
  // не показывает. Запоминаем это, и пункт «Смотреть рядом» в меню больше не появляется
  function splitGiveUp() {
    if (splitMode === 'multiview') { splitStart(splitList, split, 'web2'); return; }
    try { localStorage.setItem('lupo.noSplit', VERSION); } catch (e) { }
    splitEnd();
    doc(t('split_watch'), t('split_none'), playerScope);
  }
  // Модель телевизора известна сразу при запуске. У Samsung два видео показывают модели с «Multi View»;
  // младшие серии Crystal UHD (номер серии меньше 8000, как DU7192), HD/Full HD и телевизоры до Tizen 7 — нет:
  // на них пункта «Смотреть рядом» нет вовсе. На остальных пункт есть (и проверяется на деле при первом включении)
  function tvModel() {
    try { if (window.webapis && webapis.productinfo) return String(webapis.productinfo.getRealModel() || webapis.productinfo.getModel() || ''); } catch (e) { }
    try { return String(tizen.systeminfo.getCapability('http://tizen.org/system/model_name') || ''); } catch (e) { }
    return '';
  }
  const TV_MODEL = tvModel();
  const splitByModel = (() => {
    if (!Player.av) return false;                          // LG и браузер: один видеопоток
    let ver = 0;
    try { ver = parseFloat(tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version')) || 0; } catch (e) { }
    if (ver && ver < 7) return false;
    const m = /[A-Z]U(\d{4})/.exec(TV_MODEL.toUpperCase());   // …DU7192…, …CU8500…
    if (m && +m[1] < 8000) return false;
    if (/^[A-Z]{2}\d{2}[A-Z]\d{4}/.test(TV_MODEL.toUpperCase())) return false;   // HD / Full HD: UE32T5300
    return true;
  })();
  function canSplit() { try { return splitByModel && !localStorage.getItem('lupo.noSplit'); } catch (e) { return splitByModel; } }

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
    // Открыта папка «Избранное»: её список сразу без убранного канала (иначе OK включал бы не тот канал)
    if (group === FAV || group === GFAV) setShown(inGroup(group));
    toast(t(on ? 'fav_added' : 'fav_removed'));
  }

  // ---------- Просмотр ----------
  let cur = -1, prev = -1, barTimer = null, retryTimer = null;
  // Предыдущий канал для ▶: сам канал, его папка и плейлист (а не номер в списке — номер теряется, когда
  // меняют папку, и ▶ тогда ничего не делал)
  let prevCh = null, playingInfo = null;
  const sameCh = (a, b) => !!a && !!b && (a === b || (a.name === b.name && a.url === b.url));
  function notePlay(c) {
    if (playingInfo && !sameCh(playingInfo.c, c)) prevCh = playingInfo;
    playingInfo = { c, g: group, pid: pl ? pl.id : null };
  }
  function goPrev() {
    const p = prevCh;
    if (!p || !pl) return false;
    if (p.pid !== pl.id) {
      const other = Store.playlists().find(x => x.id === p.pid && !x.off);
      if (!other || !Store.channels(other.id)) return false;
      loadPlaylist(other, Store.channels(other.id));
    }
    if (group !== p.g) { group = p.g; setShown(inGroup(group)); }
    let j = shown.findIndex(x => sameCh(x, p.c));
    if (j < 0) { group = ALL; setShown(inGroup(ALL)); j = shown.findIndex(x => sameCh(x, p.c)); }
    if (j < 0) return false;
    play(j);
    return true;
  }
  // Плеер заняли чем-то другим (фильм, «Смотреть рядом», другой плейлист, запасной движок): отложенное включение
  // канала (повтор через 7 с, проверка потока, слежение за подгрузкой) отменяется, иначе оно включит канал поверх
  function cancelPending() { clearTimeout(retryTimer); clearTimeout(stallTimer); startToken++; }
  // Канал не пошёл за 7 с (бывает при запуске программы) — включаем его ещё раз сами
  // Медленный канал, который плеер ещё открывает, не трогаем: ждём до 20 с и только тогда включаем заново
  function armRetry(c, url, late) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (!(shown[cur] === c && !vod && split < 0 && screen === 'player' && !Player.isPlaying())) return;
      if (!late && Player.isOpening && Player.isOpening()) return armRetry(c, url, true);
      startChannel(c, url);
    }, late ? 13000 : 7000);
  }

  // ---------- Архив передач ----------
  let arch = null, archT0 = 0, pendingSeek = 0, seekTimer = null;
  function streamUrl(c) {
    archT0 = Date.now();
    Player.setUa(c.ua);
    return arch ? (Catchup.url(c, arch.p, arch.from) || c.url) : c.url;
  }
  // Прошедшая передача: из архива, если он есть у канала
  function playArchive(i, p) {
    const c = shown[i];
    if (!c || !Catchup.available(c, p)) { toast(t('archive_none')); return false; }
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
      if (!arch) { pendingSeek = 0; return; }
      const p = arch.p;
      const target = Math.min(Date.now() - 60000, Math.max(p.s, Math.min(Math.max(p.s, p.e - 60000), archPos() + pendingSeek * 1000)));
      pendingSeek = 0;
      play(cur, { p, from: target });
    }, 700);
  }
  // Эфир оборвался или долго «думает» — переподключаемся сами, как в Android (так бывает у радио HLS:
  // родной плеер Samsung считает живой поток законченным). Ошибка — только если три переподключения за минуту не помогли
  // Если родной плеер Samsung не справляется с каналом (ошибка или второй обрыв за минуту) — канал переходит
  // на запасной движок (браузерный, hls.js), как в Android «другой движок». Выбор запоминается для канала
  let reconnects = [], stallTimer = null;
  // Версия 0.33 отправляла все радио «только звук» в запасной плеер — часть станций перестала открываться.
  // Правило убрано; выбор движка, запомненный той версией, сбрасывается один раз
  try { if (localStorage.getItem('lupo.webReset') !== '35') { localStorage.removeItem('lupo.webEngine'); localStorage.setItem('lupo.webReset', '35'); } } catch (e) { }
  function webList() { try { return JSON.parse(localStorage.getItem('lupo.webEngine') || '[]'); } catch (e) { return []; } }
  function webEngine(c) { return !!c && Player.native && webList().includes(favKey(c)); }
  function setWeb(c, on) {
    const l = webList().filter(k => k !== favKey(c));
    if (on) l.push(favKey(c));
    try { localStorage.setItem('lupo.webEngine', JSON.stringify(l.slice(-300))); } catch (e) { }
  }
  const webFailed = new Set();   // каналы, которые запасной плеер не открыл (до выхода из программы к нему не возвращаемся)
  function toWebEngine(c, why) {
    // Станция шла одним потоком и всё равно замерла — этот способ для неё больше не пробуем
    if (onVariant === c) {
      onVariant = null;
      const l = noVariant().filter(k => k !== favKey(c)); l.push(favKey(c));
      try { localStorage.setItem('lupo.noVariant', JSON.stringify(l.slice(-300))); } catch (e) { }
      Store.addNote(new Date().toLocaleString(LANG) + ' — ' + c.name + '\n' + why + ' (one variant)');
      if (webEngine(c)) { reconnects = []; cancelPending(); Player.start(streamUrl(c), { web: true }); return true; }
    }
    if (!Player.native || webEngine(c) || arch || webFailed.has(favKey(c))) return false;
    setWeb(c, true);
    reconnects = [];
    Store.addNote(new Date().toLocaleString(LANG) + ' — ' + c.name + '\n' + why + ' → hls.js');
    cancelPending();
    Player.start(streamUrl(c), { web: true });
    return true;
  }
  // Родной плеер Samsung читает номер кусочка эфира (EXT-X-MEDIA-SEQUENCE) как 32-битное число. У многих
  // радио и каналов номер больше (время в микросекундах) — плеер играет один кусочек и останавливается.
  // Перед первым включением такого канала смотрим его список и сразу включаем браузерный плеер (hls.js),
  // не дожидаясь, пока родной споткнётся
  const seqChecked = new Map();   // адрес канала → true (номер кусочка слишком большой) / false
  // Что за поток HLS: big — номер кусочка не помещается в 32 бита; audio — адрес одного качества у радио
  // «только звук» с несколькими качествами. Родной плеер Samsung, переключаясь между качествами звука, замирает
  // (известная ошибка), поэтому таким станциям даём один поток — самый качественный — и переключаться ему не между чем
  async function hlsKind(url) {
    const get = async u => {
      const r = await Promise.race([fetch(u, { cache: 'no-store' }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return { text: await r.text(), url: r.url || u };
    };
    let r = await get(url), audio = null;
    if (/#EXT-X-STREAM-INF/.test(r.text)) {
      const lines = r.text.split(/\r?\n/), vars = [];
      lines.forEach((l, i) => {
        if (!l.startsWith('#EXT-X-STREAM-INF')) return;
        const uri = lines.slice(i + 1).find(x => x && !x.startsWith('#'));
        if (uri) vars.push({ bw: +((/[^-]BANDWIDTH=(\d+)/.exec(l) || [])[1] || 0), audio: /CODECS="[^"]*mp4a/i.test(l) && !/avc|hvc|hev|vp0?9|av01/i.test(l) && !/RESOLUTION=/i.test(l), uri: uri.trim() });
      });
      if (!vars.length) return { big: false, audio: null };
      const best = vars.slice().sort((x, y) => y.bw - x.bw)[0];
      const vurl = new URL(best.uri, r.url).href;
      if (vars.every(v => v.audio)) audio = vurl;
      r = await get(vurl);
    }
    const m = /#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/.exec(r.text);
    return { big: !!m && (m[1].length > 10 || Number(m[1]) > 2147483647), audio };
  }
  // Станции, которым один поток не помог (всё равно замерли), — им остаётся запасной плеер
  function noVariant() { try { return JSON.parse(localStorage.getItem('lupo.noVariant') || '[]'); } catch (e) { return []; } }
  let startToken = 0, onVariant = null;
  function startChannel(c, url) {
    const my = ++startToken;
    onVariant = null;
    const skipVariant = noVariant().includes(favKey(c));
    // Станция, которая уже хорошо идёт через запасной плеер, так через него и идёт — ничего не меняем
    if (!Player.av || arch || !/m3u8/i.test(url) || webEngine(c) || seqChecked.get(c.url) === 'plain') {
      Player.start(url, { web: webEngine(c) });
      return;
    }
    Player.stop();   // пока проверяется поток нового канала, старый не играет (и его обрывы не записываются на новый)
    hlsKind(url).catch(() => ({ big: false, audio: null })).then(k => {
      if (my !== startToken) return;
      // Поток с номером сеанса в адресе (hlssid — hostingradio.ru: Like FM, DFM, Рекорд, Energy, Жара FM…): сеанс
      // открыт нашей проверкой, и родной плеер Samsung по такому адресу получает отказ (в журнале
      // «PLAYER_ERROR_CONNECTION_FAILED (one variant)», потом всё равно запасной плеер — лишние секунды при запуске).
      // Такие станции сразу идут через запасной плеер (hls.js) — он сам открывает свой сеанс
      if (k.audio && /[?&]hlssid=/i.test(k.audio) && !webEngine(c)) {
        setWeb(c, true);
        Store.addNote(new Date().toLocaleString(LANG) + ' — ' + c.name + '\nsession stream → hls.js');
        Player.start(url, { web: true });
        return;
      }
      if (k.audio && !skipVariant) {
        // Радио: один поток в родном плеере
        onVariant = c;
        Player.start(k.audio);
        return;
      }
      if (!k.audio && !k.big) seqChecked.set(c.url, 'plain');   // обычный канал — больше не проверяем
      if (k.big && !webEngine(c)) {
        setWeb(c, true);
        Store.addNote(new Date().toLocaleString(LANG) + ' — ' + c.name + '\nmedia sequence → hls.js');
      }
      Player.start(url, { web: webEngine(c) });
    });
  }
  function reconnect(why) {
    const c = shown[cur];
    if (!c || vod || split >= 0) return;
    const now = Date.now();
    reconnects = reconnects.filter(x => now - x < 60000);
    if (reconnects.length >= 1 && toWebEngine(c, why)) return;
    if (reconnects.length >= 3) { reconnects = []; return playError(why + ' (3×)'); }
    reconnects.push(now);
    // Архив продолжается с того места, где оборвался, а не с начала передачи
    if (arch) { archResume(archPos()); return; }
    startChannel(c, streamUrl(c));
  }
  // Архив оборвался: открываем поток заново с того же места (at) или эфир (at пуст), не трогая то, что на экране —
  // открытое меню, список или диалог остаются (раньше обрыв закрывал их и «выкидывал» из меню)
  function archResume(at) {
    const c = shown[cur];
    if (!c) return;
    if (at) arch = { p: arch.p, from: at };
    else { arch = null; clearTimeout(seekTimer); pendingSeek = 0; }
    $('pl-spinner').classList.remove('hidden');
    const url = streamUrl(c);
    startChannel(c, url);
    armRetry(c, url);
    if (!$('bar').classList.contains('hidden')) fillBar();
  }
  Player.on('buffering', on => {
    clearTimeout(stallTimer);
    if (on && !vod) stallTimer = setTimeout(() => { if (screen === 'player' && cur >= 0 && !arch) reconnect('buffering 15 s'); }, 15000);
  });
  Player.on('playing', () => clearTimeout(stallTimer));
  // Поток кончился: архив — продолжаем с того же места или возвращаемся в эфир; эфир — переподключение
  Player.on('ended', () => {
    if (vod || screen !== 'player' || cur < 0) return;
    if (!arch) return reconnect('stream ended');
    const at = archPos();
    if (at < arch.p.e - 60000 && at < Date.now() - 60000) archResume(at);
    else archResume(0);
  });

  Player.on('error', playError);
  // Слишком много попыток открыть один адрес подряд — останавливаемся и говорим об этом
  Player.on('giveup', () => { $('pl-spinner').classList.add('hidden'); toast(t('play_error')); });
  // Родной плеер замер без сообщений — сразу запасной (если он этот канал умеет), иначе открываем заново
  Player.on('frozen', () => {
    const c = shown[cur];
    if (!c || vod || split >= 0 || screen !== 'player') return;
    if (!toWebEngine(c, 'AVPlay frozen')) reconnect('AVPlay frozen');
  });
  function playError(msg) {
    $('pl-spinner').classList.add('hidden');
    if (vod) {
      toast(t('vod_play_error', msg));
      Store.addLog(new Date().toLocaleString(LANG) + ' — ' + vod.titles[vod.idx] + '\n' + msg);
      return;
    }
    if (screen !== 'player' || cur < 0) return;
    const c = shown[cur];
    // Родной плеер не открыл канал — пробуем запасной движок; запасной тоже не смог — забываем его для канала
    if (c && split < 0 && toWebEngine(c, msg)) return;
    if (c && webEngine(c) && Player.usingWeb() && !Player.everPlayed()) {
      // Запасной плеер канал не открыл — возвращаем канал родному плееру
      setWeb(c, false);
      webFailed.add(favKey(c));
      Store.addNote(new Date().toLocaleString(LANG) + ' — ' + c.name + '\nhls.js: ' + msg + ' → AVPlay');
      cancelPending();
      Player.start(streamUrl(c));
      return;
    }
    toast(t('play_error'));
    const d = new Date();
    Store.addLog(d.toLocaleDateString(LANG) + ' ' + hm(d) + ' — ' + (c ? c.name : '') + '\n' + msg + (c ? '\n' + c.url : ''));
  }
  Player.on('buffering', on => $('pl-spinner').classList.toggle('hidden', !on));
  Player.on('playing', () => { $('pl-spinner').classList.add('hidden'); $('guide').classList.toggle('playing', true); });
  // Радио по названию, но в потоке есть картинка (у многих станций видеоэфир) — показываем видео, а не экран радио
  Player.on('playing', () => {
    const c = shown[cur];
    [1500, 4000, 8000].forEach(ms => setTimeout(() => {
      if (!c || shown[cur] !== c || !Radio.isOn()) return;
      const i = Player.info();
      if (i.w > 0 || i.h > 0) Radio.hide();
    }, ms));
  });
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

  const unlocked = timedSet();   // каналы, для которых PIN уже введён (действует 10 минут)
  // Канал под PIN-кодом (сам или его папка), и PIN в этот раз ещё не вводили
  function needsPin(c) {
    return !!c && ((isLocked(c) && !unlocked.has(favKey(c))) || (isGroupLocked(c.group, c._pl) && !unlockedGroups.has(groupKey(c.group, c._pl))));
  }
  function play(i, a) {
    if (!shown.length) return;
    const want = shown[(i + shown.length) % shown.length];
    // Канал не из закрытой папки — закрытые папки снова закрыты
    if (want && !isGroupLocked(want.group, want._pl)) relockFolders();
    // Тот же канал, что уже идёт (повтор, переподключение) — код заново не спрашиваем
    if (want !== playingCh && needsPin(want)) {
      const back = Nav.state();
      return checkPin(() => { unlocked.add(favKey(want)); unlockedGroups.add(groupKey(want.group, want._pl)); play(i, a); }, back);
    }
    closeSide();
    // a — передача из архива {p, from}; без него — прямой эфир
    arch = a ? { p: a.p, from: a.from || a.p.s } : null;
    const next = (i + shown.length) % shown.length;
    if (!a || !a.from) { clearTimeout(seekTimer); pendingSeek = 0; }
    // Другой канал — счёт обрывов и слежение за подгрузкой начинаются заново
    if (shown[next] !== playingCh) { reconnects = []; clearTimeout(stallTimer); }
    if (next !== cur) prev = cur;
    cur = next;
    jumped = false;
    const c = shown[cur];
    playingCh = c;
    notePlay(c);
    show('player');
    closeGuide();
    playerScope();
    $('pl-spinner').classList.remove('hidden');
    const url = streamUrl(c);
    startChannel(c, url);
    if (Radio.looks(c)) Radio.show(c, dispName(c)); else Radio.hide();
    armRetry(c, url);
    Store.saveLast({ pl: pl.id, group, name: c.name, url: c.url });
    showBar();
  }

  function showBar() {
    const c = shown[cur];
    if (!c) return;
    $('bar-name').textContent = dispName(c);
    $('bar-group').textContent = '';
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
  // Настоящая скорость потока канала. Плеер Samsung вместо неё отдаёт число вроде «100 Мбит/с» (предел, а не поток),
  // поэтому узнаём сами: в списке HLS у каждого качества записана его скорость (BANDWIDTH) и размер кадра;
  // если списка качеств нет — скачиваем последний кусочек эфира и делим его размер на длительность
  const rates = new Map();   // адрес канала → {kbps, h} или null (узнать нельзя)
  function snapKbps(k) {
    const std = [24, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
    const n = std.reduce((a, b) => (Math.abs(b - k) < Math.abs(a - k) ? b : a));
    return Math.abs(n - k) <= n * 0.1 ? n : k;
  }
  async function measureStream(url) {
    const get = async (u, bin) => {
      const r = await Promise.race([fetch(u, { cache: 'no-store' }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))]);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return bin ? r.arrayBuffer() : r.text();
    };
    if (!/m3u8/i.test(url)) {
      // Радио одним потоком (Icecast/Shoutcast, mp3/aac): битрейт меряем сами, как в Android — сколько байт
      // пришло за 4 секунды (после первой секунды: в начале сервер отдаёт запас быстрее, чем идёт эфир)
      // Только для радио: у обычного канала (.ts) это было бы второе подключение к провайдеру, а у многих
      // подписок разрешено одно — показ мог обрываться
      if (!Radio.isOn()) return null;
      if (!/^https?:/i.test(url) || typeof AbortController === 'undefined') return null;
      const ctl = new AbortController();
      const tm = setTimeout(() => ctl.abort(), 9000);
      try {
        const r = await fetch(url.split('|')[0], { cache: 'no-store', signal: ctl.signal });
        if (!r.ok || !r.body) return null;
        const type = r.headers.get('content-type') || '';
        if (/video|mpegurl|text|html|json/i.test(type)) return null;
        const reader = r.body.getReader();
        const t0 = Date.now();
        let bytes = 0, from = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const el = Date.now() - t0;
          if (el < 1000) continue;
          if (!from) from = Date.now();
          bytes += value.byteLength;
          if (Date.now() - from >= 4000) break;
        }
        // Станция сама назвала битрейт (заголовок icy-br) — он точный; иначе замер, подтянутый к ближайшему
        // обычному значению (замер 134 → 128: в потоке есть ещё служебные данные)
        const icy = parseInt(String(r.headers.get('icy-br') || '').split(',')[0], 10);
        if (icy > 0 && icy <= 2000) return { kbps: icy, h: 0 };
        const ms = from ? Date.now() - from : 0;
        const k = ms >= 2000 ? Math.round(bytes * 8 / ms) : 0;
        return k >= 8 && k <= 2000 ? { kbps: snapKbps(k), h: 0 } : null;
      } catch (e) { return null; }
      finally { clearTimeout(tm); try { ctl.abort(); } catch (e) { } }
    }
    let text = await get(url);
    let base = url;
    if (/#EXT-X-STREAM-INF/.test(text)) {
      const lines = text.split(/\r?\n/), vars = [];
      lines.forEach((l, i) => {
        if (!l.startsWith('#EXT-X-STREAM-INF')) return;
        const bw = +((/AVERAGE-BANDWIDTH=(\d+)/.exec(l) || [])[1] || (/[^-]BANDWIDTH=(\d+)/.exec(l) || [])[1] || 0);
        const h = +((/RESOLUTION=\d+x(\d+)/.exec(l) || [])[1] || 0);
        const uri = lines.slice(i + 1).find(x => x && !x.startsWith('#'));
        vars.push({ bw, h, uri });
      });
      if (!vars.length) return null;
      const ph = Player.info().h;
      // То качество, которое сейчас показывает плеер (по размеру кадра), иначе самое высокое
      const v = (ph && vars.find(x => x.h === ph)) || vars.slice().sort((a, b) => b.bw - a.bw)[0];
      // Радио (у качеств нет размера кадра): настоящий битрейт по кусочку эфира, а не заявленный в списке
      const radio = vars.every(x => !x.h && x.bw && x.bw < 500000);   // все качества — только звук
      if (v.bw && !radio) return { kbps: Math.round(v.bw / 1000), h: v.h };
      text = await get(new URL(v.uri, url).href);
      base = new URL(v.uri, url).href;
    }
    // Список кусочков: последний кусочек — размер в битах / длительность
    const lines = text.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = /^#EXTINF:([\d.]+)/.exec(lines[i]);
      if (!m) continue;
      const uri = lines.slice(i + 1).find(x => x && !x.startsWith('#'));
      const dur = parseFloat(m[1]);
      if (!uri || !(dur > 0)) return null;
      const size = (await get(new URL(uri, base).href, true)).byteLength;
      return { kbps: snapKbps(Math.round(size * 8 / dur / 1000)), h: 0 };
    }
    return null;
  }
  function streamRate(c) {
    if (!c) return null;
    if (!rates.has(c.url)) {
      rates.set(c.url, null);
      // Не получилось (сайт не ответил) — через 30 секунд пробуем ещё раз, а не до выхода из программы
      const again = () => setTimeout(() => { if (rates.get(c.url) === null) rates.delete(c.url); }, 30000);
      measureStream(c.url).then(r => { rates.set(c.url, r); if (!r) again(); if (!$('bar').classList.contains('hidden')) bubbles(); }).catch(again);
    }
    return rates.get(c.url);
  }
  function bubbles() {
    const box = $('bar-bubbles');
    const i = Player.info();
    const r = vod ? null : streamRate(shown[cur]);
    const h = (r && r.h) || i.h;
    // Радио: битрейт звука (128, 320 кбит/с), как в Android. Если замер потока ещё не готов или не удался —
    // берём то, что знает сам плеер
    const live = Radio.isOn() && Player.usingWeb() && i.kbps ? snapKbps(i.kbps) : 0;   // радио: замер по кусочкам эфира
    const kbps = live || (r && r.kbps) || (Player.native && !Player.usingWeb() && (i.w || i.h) ? 0 : i.kbps);
    const out = [];
    if (h) out.push(h >= 2000 ? '4K' : h >= 1400 ? '1440p' : h >= 1000 ? '1080p' : h >= 700 ? '720p' : h + 'p');
    if (kbps) out.push(kbps >= 1000 ? t('bitrate_mbps', (kbps / 1000).toFixed(1)) : t('bitrate_kbps', kbps));
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
    $('sched').classList.remove('center');   // полная программа — справа, как раньше
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
  // Папка другого плейлиста в списке слева: каналы только показываются. Идущий канал не трогаем и плейлист
  // не меняем, пока на канале не нажали OK (как в Android)
  let sideOther = null;   // {p, g} или null — папка своего плейлиста
  function otherChannels(p, g) {
    const d = Store.channels(p.id);
    if (d) Epg.ensure(p.id, d.epg || [], d.channels);
    const own = c => Object.assign({ _pl: p.id }, c);
    let list = noAdult(d && d.channels);
    if (g === FAV) { const pre = p.id + '|', m = new Map(list.map(c => [c.name, c]).reverse()); return Store.favorites().filter(k => k.startsWith(pre)).map(k => m.get(k.slice(pre.length))).filter(Boolean).map(own); }
    if (g !== ALL) list = list.filter(c => c.group === g);
    return list.map(own);
  }
  function openSide() {
    sideOther = null;
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
    $('side-title').textContent = sideOther ? sideOther.p.name + ' · ' + groupLabel(sideOther.g) : groupLabel(sideGroup);
    sideShown = sideOther ? otherChannels(sideOther.p, sideOther.g) : inGroup(sideGroup);
    // Курсор — на канале, который сейчас играет (если он есть в этой папке), иначе на первом
    const playing = playingCh || shown[cur];
    const idx = playing ? sideShown.findIndex(c => c === playing || (c.url === playing.url && c.name === playing.name)) : -1;
    drawSide(Math.max(0, idx));
    if (!sideShown.length) { box.textContent = t('panel_empty'); sideEpg(null); }
    Nav.focus(sideRow(Math.max(0, idx)));
  }
  // В списке на экране только «окно» из 200 строк вокруг курсора: в плейлисте бывают десятки тысяч каналов,
  // и строить строку для каждого телевизору тяжело. Курсор подошёл к краю окна — окно сдвигается
  const SIDE_WIN = 200;
  let sideFrom = 0, sideLast = 0;
  function drawSide(center) {
    const box = $('side-list');
    sideFrom = Math.max(0, Math.min(center - SIDE_WIN / 2, sideShown.length - SIDE_WIN));
    box.innerHTML = '';
    sideShown.slice(sideFrom, sideFrom + SIDE_WIN).forEach((c, k) => {
      const i = sideFrom + k;
      const el = channelRow(c, i);
      el._i = i;
      el.onclick = () => sidePlay(i);
      el.addEventListener('focus', () => {
        sideLast = i;
        sideEpg(c);
        const edge = (i < sideFrom + 20 && sideFrom > 0) || (i >= sideFrom + SIDE_WIN - 20 && sideFrom + SIDE_WIN < sideShown.length);
        if (edge) setTimeout(() => {
          if (document.activeElement !== el) return;
          const off = el.offsetTop - box.scrollTop;
          drawSide(i);
          const now = sideRow(i);
          Nav.focus(now);
          if (now) box.scrollTop = now.offsetTop - off;
        }, 0);
      });
      box.appendChild(el);
    });
  }
  // Строка канала с номером i (окно сдвигается к ней, если её сейчас нет на экране)
  function sideRow(i) {
    if (i < 0 || i >= sideShown.length) return null;
    if (i < sideFrom || i >= sideFrom + SIDE_WIN) drawSide(i);
    return $('side-list').children[i - sideFrom];
  }
  function sidePlay(i, p) {
    if (splitPending) {
      // Второй канал для «Смотреть рядом»
      splitPending = false;
      const list = sideShown.slice();
      const second = list[i];
      // Канал под PIN-кодом рядом открывается только после кода (раньше «рядом» показывал его без кода)
      if (second && second !== shown[cur] && needsPin(second)) {
        const back = Nav.state();
        return checkPin(() => { unlocked.add(favKey(second)); unlockedGroups.add(groupKey(second.group, second._pl)); closeSide(); splitStart(list, i); },
          () => { splitPending = true; back(); });
      }
      closeSide();
      if (list[i] === shown[cur]) { playerScope(); return; }
      splitStart(list, i);
      return;
    }
    if (sideOther) {
      // OK на канале другого плейлиста — вот теперь переходим на этот плейлист и его папку
      const o = sideOther, c = sideShown[i];
      sideOther = null;
      closeSide();
      loadPlaylist(o.p, Store.channels(o.p.id));
      group = o.g;
      setShown(inGroup(group));
      prev = -1;
      let j = shown.findIndex(x => x.name === c.name && x.url === c.url);
      if (j < 0) { group = ALL; setShown(inGroup(ALL)); j = shown.findIndex(x => x.name === c.name && x.url === c.url); }
      if (j < 0) return;
      if (p) playArchive(j, p); else play(j);
      return;
    }
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
  let sideExpanded = null;
  function openSideGroups(focusPid) {
    const box = $('side-groups');
    if (focusPid === undefined) sideExpanded = sideOther ? sideOther.p.id : pl ? pl.id : null;
    groupTree(box, sideExpanded, (id, pid) => { sideExpanded = id; openSideGroups(pid); },
      (p, g) => {
        if (!p) { relockFolders(); sideScope(); sideOther = null; sideGroup = GFAV; hideSideGroups(); renderSide(false); return; }
        openLockedGroup(g, p.id, async () => {
          sideScope();
          if (pl && p.id === pl.id) { sideOther = null; sideGroup = g; hideSideGroups(); renderSide(false); return; }
          // Другой плейлист: его каналы просто показываются в списке (если ещё не скачаны — скачиваются)
          if (!Store.channels(p.id)) {
            toast(t('refreshing'));
            try { Store.saveChannels(p.id, await M3U.load(p, t('no_group'), n => t('channel_n', n))); }
            catch (e) { toast(t('load_error', errorText(e)).split('\n')[0]); return; }
          }
          sideOther = { p, g };
          hideSideGroups();
          renderSide(false);
        }, () => { sideScope(); openSideGroups(); });
      },
      (pid, g) => (pid === null ? !sideOther && sideGroup === GFAV
        : sideOther ? pid === sideOther.p.id && g === sideOther.g : pl && pid === pl.id && g === sideGroup));
    box.classList.remove('hidden');
    $('side').classList.add('with-groups');
    if (focusPid !== undefined) {
      const heads = [...box.querySelectorAll('.pl-head')];
      const idx = Store.playlists().filter(p => !p.off).findIndex(p => p.id === focusPid);
      if (heads[idx]) { Nav.focus(heads[idx]); return; }
    }
    Nav.focus(box.querySelector('.grp.on') || box.firstChild);
  }
  function hideSideGroups() { $('side-groups').classList.add('hidden'); $('side').classList.remove('with-groups'); }
  let moving = null;   // канал, который сейчас перемещаем в избранном
  function sideKeys(e) {
    const el = document.activeElement;
    if (moving) return moveKeys(e);
    // Цифры — номер в том списке, который сейчас на экране (он может быть из другой папки, чем идущий канал)
    if (digitKey(e, n => { if (n <= sideShown.length && !$('side').classList.contains('hidden')) sidePlay(n - 1); })) return true;
    if (e.keyCode === 13 && el && el.classList.contains('ch') && el.closest('#side-list')) {
      const i = el._i;
      const again = () => { sideScope(); renderSide(false); Nav.focus(sideRow(Math.min(i, sideShown.length - 1))); };
      return holdOk(e, () => sidePlay(i), () => {
        // Удерживать OK на канале — меню: смотреть рядом, избранное, звук, субтитры, переименовать, PIN-код на канал
        // (в «Избранном» ещё и «Переместить»)
        const c = sideShown[i];
        if (!c) return again();
        chMenu(c, again, {
          split: () => { splitPending = true; sidePlay(i); },
          tracks: true,
          move: !sideOther && sideGroup === FAV ? () => startMove(c) : null
        });
      });
    }
    // Удерживать OK на папке — PIN-код на папку (как в меню папок у телепрограммы)
    if (e.keyCode === 13 && el && el._g !== undefined && el._pid && el.closest('#side-groups')) {
      const pid = el._pid;
      return holdOk(e, () => el.click(), () => groupMenu(el._g, pid, () => { sideScope(); openSideGroups(pid); }));
    }
    // Список каналов по кругу: с последнего вниз — на первый, с первого вверх — на последний
    if ((e.keyCode === 38 || e.keyCode === 40) && el && el.classList.contains('ch') && el.closest('#side-list')) {
      const i = el._i;
      if (e.keyCode === 40 && i === sideShown.length - 1) { Nav.focus(sideRow(0)); return true; }
      if (e.keyCode === 38 && i === 0) { Nav.focus(sideRow(sideShown.length - 1)); return true; }
    }
    const where = el && (el.closest('#side-groups') ? 'groups' : el.closest('#side-epg') ? 'epg' : 'channels');
    if (e.keyCode === 37) {
      if (where === 'channels') { openSideGroups(); return true; }
      if (where === 'epg') { const c = $('side-epg-title').textContent; const i = sideShown.findIndex(x => x.name === c); Nav.focus(sideRow(Math.max(0, i))); return true; }
      return true;
    }
    if (e.keyCode === 39) {
      if (where === 'groups') { hideSideGroups(); Nav.focus(sideRow(Math.min(sideLast, sideShown.length - 1))); return true; }
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
    const el = sideRow(i);
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
    else if (k === 13 || [27, 8, 10009, 461].includes(k)) { moving = null; renderSide(false); setShown(inGroup(group)); Nav.focus(sideRow(i)); return true; }
    else return true;
    f.splice(i, 1);
    f.splice(j, 0, moving);
    Store.saveFavorites(f);
    renderMove();
    return true;
  }
  function sideBack() {
    if (!$('side-groups').classList.contains('hidden')) { hideSideGroups(); Nav.focus(sideRow(Math.min(sideLast, sideShown.length - 1))); return; }
    closeSide();
  }
  function closeSide() {
    if (splitPending && split < 0) { splitPending = false; }
    $('side').classList.add('hidden');
    $('side-list').innerHTML = '';   // строки списка не держим в памяти, пока он закрыт
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
    if (!list.length) { toast(t('no_tracks')); playerScope(); return; }
    if (list.length === 1) { toast(t('one_track')); playerScope(); return; }
    pick(t('audio_track'), list.map((a, i) => ({ label: trackLabel(a, i), on: a.on })), i => { Player.setAudio(i); playerScope(); }, playerScope);
  }
  function openSubsMenu() {
    const list = Player.subTracks();
    if (!list.length) { toast(t('no_subtitles')); playerScope(); return; }
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
      if (k === 415 || k === 19 || k === 10252) { Player.pause(k === 415 ? false : k === 19 ? true : undefined); vodBar(); return true; }
      if (k === 413) { vodExit(); return true; }   // «Стоп» на пульте   // кнопки «Пауза» и «Воспроизвести» на пульте
      if (k === 412 || k === 417) { vodSeekBy(k === 412 ? -10000 : 30000); return true; }    // перемотка на пульте
      return false;
    }
    if (arch && (k === 412 || k === 417)) { seekBy(k === 412 ? -30 : 30); return true; }
    if (arch && (k === 415 || k === 19 || k === 10252)) { Player.pause(k === 415 ? false : k === 19 ? true : undefined); showBar(); return true; }
    switch (k) {
      case 38: case 427: case 33: play(cur + 1); return true;   // вверх / канал+ (Samsung 427, LG 33) — следующий номер
      case 40: case 428: case 34: play(cur - 1); return true;   // вниз / канал− (Samsung 428, LG 34) — предыдущий номер
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
    else if (k === 39) { if (!goPrev()) showBar(); }
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
    inputDialog(t('pin_new'), '', 'pin', (v, err) => {
      if (!/^\d{4}$/.test(v)) { err(t('pin_new')); return false; }
      setTimeout(() => inputDialog(t('pin_repeat'), '', 'pin', (w, err2) => {
        if (w !== v) { err2(t('pin_mismatch')); return false; }
        setTimeout(() => done(v), 0);
      }, back, v.length), 0);
    }, back, 4);
  }

  // ---------- PIN-код на вход в программу (по умолчанию выключен) ----------
  function appPinSettings(back) {
    if (!Store.appPin()) {
      newPin(v => { Store.saveAppPin(v); toast(t('pin_enabled')); back(); }, back);
      return;
    }
    pick(t('pin_button'), [{ label: t('pin_disable') }], () => {
      inputDialog(t('pin_current'), '', 'pin', (v, err) => {
        if (v !== Store.appPin()) { err(t('pin_wrong')); return false; }
        Store.saveAppPin(null);
        toast(t('pin_disabled'));
        setTimeout(back, 0);
      }, back, Store.appPin().length);
    }, back);
  }
  // При запуске: спросить PIN до того, как что-то показать
  function askAppPin(then) {
    if (!Store.appPin()) return then();
    let tries = 0;
    const ask = () => inputDialog(t('pin_enter'), '', 'pin', (v, err) => {
      if (v === Store.appPin()) { setTimeout(then, 0); return; }
      tries++;
      err(t('pin_wrong'));
      return false;
    }, () => askExit(ask), Store.appPin().length);   // «Отмена» в вопросе о выходе — снова ввод PIN-кода
    $('pin-cover').classList.remove('hidden');
    ask();
  }

  // ---------- Заставка: логотип «надувается», как пузырь ----------
  // ---------- Первый запуск: условия использования и конфиденциальность (как в Android, Legal.kt) ----------
  // Пока человек не поставил галочку «Я прочитал(а) и принимаю» и не нажал «Продолжить», Лупо не открывается.
  // LEGAL_VERSION — номер редакции документов: увеличить — и согласие спросят заново у всех
  const LEGAL_VERSION = 3;
  function legalAccepted() { try { return (+localStorage.getItem('lupo.legal') || 0) >= LEGAL_VERSION; } catch (e) { return false; } }
  function requireLegal(then) {
    if (legalAccepted()) return then();
    $('pin-cover').classList.remove('hidden');
    let checked = false;
    const render = focusId => {
      const btns = $('doc-btns');
      btns.innerHTML = '';
      const old = $('legal-check');
      if (old) old.remove();
      $('doc-title').textContent = t('legal_title');
      $('doc-text').textContent = t('legal_intro');
      $('doc-text').scrollTop = 0;
      // Галочка — отдельной строкой над кнопками
      const check = document.createElement('div');
      check.id = 'legal-check';
      check.className = 'pick-item focusable' + (checked ? ' on' : '');
      check.tabIndex = 0;
      check.textContent = (checked ? '☑  ' : '☐  ') + t('legal_check');
      $('doc').insertBefore(check, btns);
      const mk = (label, primary, act) => {
        const b = document.createElement('button');
        b.className = 'btn' + (primary ? ' primary' : '');
        b.textContent = label;
        b.onclick = act;
        btns.appendChild(b);
        return b;
      };
      const read = mk(t('legal_read'), false, () => {
        const back = () => render('read');
        check.remove();
        $('doc').classList.add('hidden');
        pick(t('legal_read'), [{ label: t('legal_terms') }, { label: t('legal_privacy') }], i => {
          if (i === 0) doc(t('legal_terms'), t('legal_terms_text') + '\n\n' + t('legal_terms_extra') + '\n\n' + t('legal_terms_extra2'), back);
          else doc(t('legal_privacy'), t('legal_privacy_text') + '\n\n' + t('legal_privacy_extra') + '\n\n' + t('legal_privacy_extra2') + '\n\n' + t('legal_privacy_tv'), back);
        }, back);
      });
      mk(t('exit_app'), false, exitApp);
      const ok = mk(t('legal_continue'), true, () => {
        if (!checked) return;
        try { localStorage.setItem('lupo.legal', String(LEGAL_VERSION)); localStorage.setItem('lupo.legalAt', String(Date.now())); } catch (e) { }
        check.remove();
        $('doc').classList.add('hidden');
        then();
      });
      ok.disabled = !checked;
      check.onclick = () => { checked = !checked; render('check'); };
      btns.classList.remove('hidden');
      $('doc').classList.remove('hidden');
      // «Назад» на этом окне — вопрос «Выйти из программы?»
      Nav.setScope($('doc'), () => askExit(() => render('check')));
      Nav.focus(focusId === 'read' ? read : checked && focusId === 'check' ? ok : check);
    };
    render('check');
  }
  function exitApp() {
    Player.stop();
    try { if (window.tizen) tizen.application.getCurrentApplication().exit(); } catch (e) { }
    try { if (window.webOS) webOS.platformBack(); } catch (e) { }
    try { window.close(); } catch (e) { }
  }
  function splash(then) {
    const el = $('splash');
    el.classList.remove('hidden');
    setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.classList.add('hidden'); then(); }, 350); }, 1300);
  }

  // ---------- «Проверить обновление»: новая версия из интернета скачивается и Лупо сразу перезапускается ----------
  // (то же место и тот же вид хранения, что у запуска — js/boot.js)
  const UPDATE_URL = 'https://raw.githubusercontent.com/Marik4elove4ek/tvplayer-apk/main/tv/';
  function newerVer(a, b) {
    const x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
    return false;
  }
  async function updText(url, ms) {
    const r = await Promise.race([fetch(url, { cache: 'no-store' }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }
  // Скачанная версия — туда же, откуда её берёт запуск (js/boot.js)
  async function saveUpdate(v, files) {
    const d = await new Promise((res, rej) => {
      const r = indexedDB.open('lupo-update', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = d.transaction('files', 'readwrite');
      tx.objectStore('files').put({ v, files, list: Object.keys(files), bad: null, at: Date.now() }, 'current');
      tx.oncomplete = res;
      tx.onerror = tx.onabort = () => rej(tx.error);
    });
  }
  // Скачать файлы версии и проверить, что каждый пришёл целиком (длина — как записано в version.json)
  async function updFiles(info) {
    const files = {};
    for (const f of info.files) files[f] = await updText(UPDATE_URL + (info.base || '') + f, 30000);
    const sizes = info.sizes || {};
    info.files.forEach(f => { if (sizes[f] && files[f].length !== sizes[f]) throw new Error('broken file ' + f + ' (' + files[f].length + ' / ' + sizes[f] + ')'); });
    if (!files['js/app.js'] || !files['js/app.js'].includes("VERSION = '" + info.v + "'")) throw new Error('files of another version');
    return files;
  }
  let updBusy = false;
  async function checkUpdate(back) {
    if (updBusy) return;
    updBusy = true;
    toast(t('update_checking'));
    let info;
    try { info = JSON.parse(await updText(UPDATE_URL + 'version.json?t=' + Date.now(), 10000)); } catch (e) {
      updBusy = false;
      if (screen !== 'settings') return;
      toast(t('update_check_failed'));
      Store.addLog(new Date().toLocaleString(LANG) + ' — update check\n' + (e && (e.message || e.name) || e));
      back(); return;
    }
    updBusy = false;
    if (screen !== 'settings') return;   // пока шла проверка, из настроек ушли
    if (!info || !newerVer(info.v, VERSION)) { toast(t('update_latest', VERSION)); back(); return; }
    $('pick').classList.add('center');
    pick(t('update_title', info.v) + '\n' + t('update_msg'), [{ label: t('update_btn') }, { label: t('update_later') }], async i => {
      if (i !== 0) return back();
      toast(t('update_downloading'));
      try {
        await saveUpdate(info.v, await updFiles(info));
        Player.stop();
        location.reload();
      } catch (e) {
        toast(t('update_failed'));
        Store.addLog(new Date().toLocaleString(LANG) + ' — update ' + info.v + '\n' + (e && (e.message || e.name) || e));
        back();
      }
    }, back);
  }

  // Телевизор часто не закрывает Лупо, а прячет его (кнопка «Домой», удержание «Назад», выключение пультом).
  // Тогда при возвращении программа не запускается заново и новую версию не проверяет — проверяем сами:
  // есть новее — тихо скачиваем и перезапускаемся (не чаще раза в 20 минут)
  // Кроме того: при запуске интернет на телевизоре может быть ещё не готов (проверка в boot.js не прошла) — поэтому
  // проверяем ещё раз через 30 секунд, через 3 минуты и дальше каждый час. Новая версия скачивается тихо:
  // в первые 3 минуты после запуска Лупо перезапускается сразу (человек только включил телевизор),
  // позже — когда Лупо спрячут (выключат телевизор или выйдут), чтобы не обрывать просмотр
  const T_START = Date.now();
  let lastUpdCheck = 0, updReady = false, updRunning = false;
  // Версия, которая на этом телевизоре не запустилась: 12 часов её не трогаем, потом пробуем снова
  function badNow(v) {
    try { return localStorage.getItem('lupo.badVersion') === v && Date.now() - (+localStorage.getItem('lupo.badAt') || 0) < 12 * 3600000; } catch (e) { return false; }
  }
  async function quietUpdate(why) {
    if (updRunning || updBusy) return;
    if (updReady) { if (why === 'return' || Date.now() - T_START < 180000) { Player.stop(); location.reload(); } return; }
    if (Date.now() - lastUpdCheck < 2 * 60000) return;
    lastUpdCheck = Date.now();
    updRunning = true;
    try {
      const info = JSON.parse(await updText(UPDATE_URL + 'version.json?t=' + Date.now(), 10000));
      if (info && newerVer(info.v, VERSION) && !badNow(info.v)) {
        await saveUpdate(info.v, await updFiles(info));
        updReady = true;
        Store.addNote(new Date().toLocaleString(LANG) + ' — update ' + info.v + ' downloaded (' + why + ')');
        if (why === 'return' || document.hidden || Date.now() - T_START < 180000) { Player.stop(); location.reload(); }
      }
    } catch (e) { Store.addLog(new Date().toLocaleString(LANG) + ' — update (' + why + ')\n' + (e && (e.message || e.name) || e)); }
    updRunning = false;
  }
  document.addEventListener('visibilitychange', () => {
    // Спрятали — скачанная версия включается сразу; вернули — проверяем, нет ли новее
    if (document.hidden) { if (updReady) location.reload(); return; }
    quietUpdate('return');
  });
  setTimeout(() => quietUpdate('start'), 30000);
  setTimeout(() => quietUpdate('start'), 180000);
  setInterval(() => quietUpdate('hourly'), 3600000);

  // Сторож памяти: телевизор даёт Лупо немного места (на Samsung около 84 МБ). Занято больше 70 % — удаляем то,
  // что скачивается заново само (сохранённую программу передач; больше 85 % — ещё и списки каналов неоткрытых
  // плейлистов). Плейлисты, избранное и настройки не трогаются никогда
  // Режим экономии запоминается (1 — программа только открытого плейлиста, 2 — и каналы только его): иначе
  // удалённое скачивалось бы и сохранялось снова, и так по кругу. Открытый плейлист, его программа и каналы,
  // которые сейчас в памяти, не трогаются — на экране ничего не пропадает
  let tight = 0;
  try { tight = +localStorage.getItem('lupo.tight') || 0; } catch (e) { }
  async function memoryGuard() {
    try {
      const u = await navigator.storage.estimate();
      if (!u.quota) return;
      const part = u.usage / u.quota;
      const lvl = part > 0.85 ? 2 : part > 0.7 ? 1 : 0;
      const was = tight;
      if (lvl > tight) tight = lvl;
      else if (part < 0.4) tight = 0;
      if (tight !== was) {
        try { localStorage.setItem('lupo.tight', String(tight)); } catch (e) { }
        Store.addNote(new Date().toLocaleString(LANG) + ' — memory ' + Math.round(u.usage / 1e6) + ' / ' + Math.round(u.quota / 1e6) + ' MB → mode ' + tight + (TV_MODEL ? ' · ' + TV_MODEL : ''));
      }
      Epg.setTight(tight >= 1);
      if (!lvl || !pl) return;
      if (tight >= 1) Epg.prune([pl.id]);
      if (tight >= 2) Store.pruneChannels([pl.id], true);
    } catch (e) { }
  }
  setInterval(memoryGuard, 30 * 60000);

  // Каналы остальных плейлистов скачиваются в фоне, если их ещё нет в памяти: общее избранное и папки
  // плейлистов видят их каналы (например, сразу после переноса копии с Android)
  async function preloadPlaylists() {
    for (const p of Store.playlists().filter(x => !x.off)) {
      if (Store.channels(p.id) || (pl && pl.id === p.id)) continue;
      try {
        Store.saveChannels(p.id, await M3U.load(p, t('no_group'), n => t('channel_n', n)), tight >= 2);
        if (group === GFAV && cur >= 0) { setShown(inGroup(GFAV)); if (!$('guide').classList.contains('hidden')) renderGuide(); }
      } catch (e) { Store.addLog(new Date().toLocaleString(LANG) + ' — ' + p.name + '\n' + errorText(e)); }
    }
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
  Promise.all([Store.ready(), autoRestore().then(devPlaylists), new Promise(r => splash(r))]).then(() => new Promise(r => requireLegal(r))).then(() => new Promise(r => askAppPin(r))).then(() => {
    $('pin-cover').classList.add('hidden');
    // Память телевизора мала: убираем каналы и программу плейлистов, которых уже нет
    const ids = Store.playlists().map(p => p.id);
    Store.pruneChannels(ids);
    Epg.prune(ids);
    Epg.setTight(tight >= 1);
    setTimeout(memoryGuard, 3000);   // после открытия плейлиста: его данные сторож не трогает
    setTimeout(preloadPlaylists, 8000);
    const on = Store.playlists().filter(p => !p.off);
    const last = Store.last();
    const lastPl = last && on.find(p => p.id === last.pl) || on[0];
    if (!lastPl) return openPlaylists();
    openGuide(lastPl, null, last && last.pl === lastPl.id);
  });
  window.LUPO_OK = true;   // программа запустилась (boot.js проверяет это для скачанных версий)
})();
