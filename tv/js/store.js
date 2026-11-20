// Хранение: плейлисты, избранное, последний канал, настройки (в памяти телевизора/браузера)
const Store = (() => {
  const K = 'lupo.';
  function get(k, def) {
    try { const v = localStorage.getItem(K + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
  }
  function set(k, v) {
    try { localStorage.setItem(K + k, JSON.stringify(v)); } catch (e) { }
  }
  return {
    playlists: () => get('playlists', []),
    savePlaylists: l => set('playlists', l),
    channels: id => get('ch.' + id, null),
    saveChannels: (id, data) => set('ch.' + id, data),
    dropChannels: id => { try { localStorage.removeItem(K + 'ch.' + id); } catch (e) { } },
    favorites: () => get('fav', []),
    saveFavorites: l => set('fav', l),
    last: () => get('last', null),
    saveLast: v => set('last', v),
    lang: () => get('lang', null),
    saveLang: v => set('lang', v),
    // Язык звука на всех каналах (null — как задаёт канал) и субтитров (null — выключены)
    audio: () => get('audio', null),
    saveAudio: v => set('audio', v),
    subs: () => get('subs', null),
    saveSubs: v => set('subs', v),
    // Вид списка каналов (rows/tiles), время показа плашки, прозрачность окон (0–3), буфер
    view: () => get('view', 'rows'),
    saveView: v => set('view', v),
    barSec: () => get('barSec', 5),
    saveBarSec: v => set('barSec', v),
    transp: () => get('transp', 1),
    saveTransp: v => set('transp', v),
    // Свои названия каналов, каналы под PIN-кодом и сам PIN (родительский контроль)
    renames: () => get('renames', {}),
    saveRenames: v => set('renames', v),
    locked: () => get('locked', []),
    saveLocked: v => set('locked', v),
    pin: () => get('pin', null),
    savePin: v => set('pin', v),
    // Родительский контроль 18+, папки под PIN-кодом, PIN на вход в программу, часы на экране
    parental: () => get('parental', false),
    saveParental: v => set('parental', v),
    lockedGroups: () => get('lockedGroups', []),
    saveLockedGroups: v => set('lockedGroups', v),
    appPin: () => get('appPin', null),
    saveAppPin: v => set('appPin', v),
    clock: () => get('clock', 'off'),
    saveClock: v => set('clock', v),
    clockRainbow: () => get('clockRainbow', false),
    saveClockRainbow: v => set('clockRainbow', v),
    leveler: () => get('leveler', false),
    saveLeveler: v => set('leveler', v),
    buffer: () => get('buffer', 'medium'),
    saveBuffer: v => set('buffer', v),
    // Журнал ошибок просмотра (последние 100)
    log: () => get('log', []),
    addLog: line => { const l = get('log', []); l.unshift(line); set('log', l.slice(0, 100)); },
    clearLog: () => set('log', [])
  };
})();
