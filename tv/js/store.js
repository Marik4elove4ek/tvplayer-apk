// Хранение: плейлисты, избранное, последний канал, настройки (в памяти телевизора/браузера)
const Store = (() => {
  const K = 'lupo.';
  function get(k, def) {
    try { const v = localStorage.getItem(K + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
  }
  // Старые версии держали каналы плейлистов в этой же памяти (всего ~5 МБ). Когда она переполнена, телевизор
  // молча отказывается записывать что-либо ещё: избранное, последний канал, восстановленную копию.
  // Каналы теперь в IndexedDB, поэтому старые записи убираем
  function purge() {
    try {
      const del = [];
      for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key && key.startsWith(K + 'ch.')) del.push(key); }
      del.forEach(key => localStorage.removeItem(key));
    } catch (e) { }
  }
  purge();
  function set(k, v) {
    const text = JSON.stringify(v);
    try { localStorage.setItem(K + k, text); } catch (e) {
      // Память переполнена: освобождаем место (журнал, отчёты о программе) и записываем ещё раз
      purge();
      try { localStorage.removeItem(K + 'log'); Object.keys(localStorage).filter(x => x.startsWith('epgrep.')).forEach(x => localStorage.removeItem(x)); } catch (e2) { }
      try { localStorage.setItem(K + k, text); } catch (e2) { }
    }
    // Плейлисты, избранное, настройки изменились — автокопия в памяти телевизора (см. app.js)
    if (!/^(ch\.|log$|last$)/.test(k) && window.LupoAutosave) window.LupoAutosave();
  }
  const chMem = new Map();
  let dbp = null;
  function openDb() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('lupo-channels', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('ch');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  function idb(mode, fn) {
    return openDb().then(d => new Promise(res => {
      const tx = d.transaction('ch', mode);
      const out = fn(tx.objectStore('ch'));
      tx.oncomplete = () => res(out && out.result);
      tx.onerror = tx.onabort = () => res(null);
    })).catch(() => null);
  }
  // Все сохранённые каналы — в память (вызывается один раз при запуске)
  async function ready() {
    try {
      const d = await openDb();
      await new Promise(res => {
        const r = d.transaction('ch').objectStore('ch').openCursor();
        r.onsuccess = () => { const c = r.result; if (!c) return res(); chMem.set(c.key, c.value); c.continue(); };
        r.onerror = () => res();
      });
    } catch (e) { }
  }
  return {
    playlists: () => get('playlists', []),
    savePlaylists: l => set('playlists', l),
    // Каналы плейлистов — в IndexedDB (в обычной памяти страницы всего ~5 МБ: несколько больших плейлистов
    // туда не помещались, и общее избранное не видело каналы других плейлистов). Читаются в память при запуске (ready)
    channels: id => chMem.has(id) ? chMem.get(id) : get('ch.' + id, null),
    saveChannels: (id, data) => { chMem.set(id, data); idb('readwrite', st => st.put(data, id)); try { localStorage.removeItem(K + 'ch.' + id); } catch (e) { } },
    dropChannels: id => { chMem.delete(id); idb('readwrite', st => st.delete(id)); try { localStorage.removeItem(K + 'ch.' + id); } catch (e) { } },
    ready,
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
