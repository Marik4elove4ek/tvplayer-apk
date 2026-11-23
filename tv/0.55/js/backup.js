// Резервная копия Лупо — тот же формат, что в Android-версии (файл .tvpb):
// JSON { app, v, np, salt, iv, data }, данные зашифрованы AES-GCM, ключ PBKDF2-SHA1 (100 000 повторов).
// Копию с Android-приставки можно восстановить на телевизоре и наоборот (плейлисты).
// Телевизор Samsung: файл пишется в «Загрузки» телевизора (переживает переустановку программы) и читается
// оттуда или с флешки. Браузер: файл скачивается, восстановление — выбором файла.
const Backup = (() => {
  const BUILT_IN = 'Lupo\u0001Player\u0001backup\u00012026';
  const ITER = 100000;
  const te = new TextEncoder(), td = new TextDecoder();

  function b64(buf) { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); }
  function unb64(s) { const r = atob(s); const a = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; }

  async function key(pass, salt) {
    const base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-1' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function pack(data, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, await key(pass || BUILT_IN, salt), te.encode(JSON.stringify(data)));
    return JSON.stringify({ app: 'TVPlayer', v: 1, np: !pass, salt: b64(salt), iv: b64(iv), data: b64(enc) });
  }

  // Ошибка расшифровки — неверный пароль или чужой файл
  async function unpack(text, pass) {
    const f = JSON.parse(text.replace(/^[﻿\s]+/, ''));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.iv), tagLength: 128 },
      await key(f.np ? BUILT_IN : (pass || ''), unb64(f.salt)), unb64(f.data));
    return JSON.parse(td.decode(plain));
  }
  function needsPassword(text) { try { return !JSON.parse(text.replace(/^[﻿\s]+/, '')).np; } catch (e) { return false; } }

  function fileName() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `Lupo-Player-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.tvpb`;
  }

  // ---------- Файлы на телевизоре Samsung ----------
  const fs = (() => { try { return window.tizen && tizen.filesystem && tizen.filesystem.openFile ? tizen.filesystem : null; } catch (e) { return null; } })();

  function tvWrite(name, text) {
    const h = fs.openFile('downloads/' + name, 'w');
    try { h.writeString(text); } finally { h.close(); }
    return name;
  }
  // Файл целиком (байты): своя копия .tvpb или копия другого плеера
  function tvRead(path) {
    const h = fs.openFile(path, 'r');
    try { return h.readData(); } finally { h.close(); }
  }
  function listDir(dir) {
    return new Promise(res => {
      try { fs.listDirectory(dir, names => res(names.map(n => dir + '/' + n)), () => res([])); } catch (e) { res([]); }
    });
  }
  // Копии: своя (.tvpb) и других плееров (TiviMate, Televizo — архивы, базы, JSON)
  const COPY = /\.(tvpb|zip|tmb|tvz|tbk|bak|backup|json|db|sqlite)$/i;
  function storages() {
    return new Promise(res => {
      try { fs.listStorages(list => res(list.filter(s => s.type === 'EXTERNAL' && s.state === 'MOUNTED').map(s => s.label)), () => res([])); } catch (e) { res([]); }
    });
  }
  // Все копии: в «Загрузках» телевизора и на флешках — новые сверху
  async function tvFind() {
    const dirs = ['downloads', ...(await storages())];
    const all = [];
    for (const d of dirs) (await listDir(d)).forEach(p => { if (COPY.test(p) || /backup/i.test(p.split('/').pop())) all.push(p); });
    // Свои копии сверху, новые раньше старых
    return all.sort().reverse().sort((a, b) => (/\.tvpb$/i.test(b) ? 1 : 0) - (/\.tvpb$/i.test(a) ? 1 : 0));
  }

  // ---------- Браузер ----------
  function browserDownload(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return name;
  }
  function browserPick() {
    return new Promise(res => {
      const i = document.createElement('input');
      i.type = 'file';
      i.onchange = () => { const f = i.files[0]; if (!f) return res(null); const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result)); r.readAsArrayBuffer(f); };
      i.click();
    });
  }

  return {
    pack, unpack, needsPassword, fileName,
    onTv: !!fs,
    save: (name, text) => fs ? tvWrite(name, text) : browserDownload(name, text),
    find: () => fs ? tvFind() : Promise.resolve([]),
    read: path => tvRead(path),
    pickFile: browserPick
  };
})();
