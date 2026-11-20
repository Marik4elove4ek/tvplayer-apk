// Управление пультом: стрелки двигают выделение к ближайшему элементу в нужную сторону
const Nav = (() => {
  // Коды кнопки «Назад»: браузер (Escape/Backspace), Samsung (10009), LG (461)
  const BACK = [27, 8, 10009, 461];
  // Клавиатура телевизора Samsung: «Готово» и «Отмена»
  const IME_DONE = 65376, IME_CANCEL = 65385;
  const DIR = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
  let scope = document;
  let onBack = null;
  let onKey = null;

  // Поля ввода сами в список не входят: пульт выбирает их рамку (.fbox), клавиатура — только по OK
  function items() {
    return [...scope.querySelectorAll('.focusable, button')]
      .filter(e => !e.closest('.hidden') && e.offsetParent !== null && !e.disabled);
  }

  function focus(el) {
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function move(dir) {
    const cur = document.activeElement;
    const all = items();
    if (!all.includes(cur)) { focus(all[0]); return; }
    const a = cur.getBoundingClientRect();
    let best = null, bestScore = Infinity;
    for (const el of all) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      // Сдвиг вбок считаем между краями, а не центрами: широкое поле под узкой кнопкой —
      // это «прямо вниз», а не «далеко вбок»
      const gapX = Math.max(0, b.left - a.right, a.left - b.right);
      const gapY = Math.max(0, b.top - a.bottom, a.top - b.bottom);
      let main, side;
      if (dir === 'up') { if (b.bottom > a.top + 2) continue; main = a.top - b.bottom; side = gapX; }
      if (dir === 'down') { if (b.top < a.bottom - 2) continue; main = b.top - a.bottom; side = gapX; }
      if (dir === 'left') { if (b.right > a.left + 2) continue; main = a.left - b.right; side = gapY; }
      if (dir === 'right') { if (b.left < a.right - 2) continue; main = b.left - a.right; side = gapY; }
      const score = main + side * 3;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) focus(best);
  }

  // Закончили ввод: клавиатура закрывается, выделение возвращается на рамку поля (клавиатура сама не открывается)
  function leaveInput(el, next) {
    el.blur();
    focus(el.closest('.fbox') || el);
    if (next) move('down');
  }

  document.addEventListener('keydown', e => {
    const k = e.keyCode;
    const el = document.activeElement;
    const typing = el && el.tagName === 'INPUT';
    if (typing) {
      if (k === IME_DONE || k === 13) { e.preventDefault(); leaveInput(el, true); return; }
      if (k === IME_CANCEL || k === 10009 || k === 461 || k === 27) { e.preventDefault(); leaveInput(el, false); return; }
      if (k === 38 || k === 40) { e.preventDefault(); leaveInput(el, false); move(DIR[k]); return; }
      return; // буквы, стирание, ◀ ▶ внутри строки — полю
    }
    if (onKey && onKey(e) === true) { e.preventDefault(); return; }
    // Удержание «Назад» на Samsung телевизор забирает себе (сам закрывает программу), поэтому «Назад» — по нажатию
    if (BACK.includes(k)) { e.preventDefault(); if (!e.repeat && onBack) onBack(); return; }
    // Длинный текст (политика, журнал): ▲▼ листают
    if (el && el.classList.contains('doc-text') && (k === 38 || k === 40)) {
      e.preventDefault();
      // Текст долистан до конца (или короткий) — ▼ переходит к кнопкам под ним («Очистить», «OK»)
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
      if (k === 40 && atEnd && items().some(x => x !== el)) { move('down'); return; }
      el.scrollTop += (k === 40 ? 1 : -1) * el.clientHeight * 0.8;
      return;
    }
    if (DIR[k]) { e.preventDefault(); move(DIR[k]); }
    else if (k === 13 && el && el.classList.contains('focusable')) {
      e.preventDefault();
      // OK на рамке поля — открыть клавиатуру телевизора
      const input = el.classList.contains('fbox') && el.querySelector('input');
      if (input) { input.focus(); try { input.click(); } catch (x) { } }
      else el.click();
    }
  });

  return {
    onLongBack() { },
    setScope(el, back, key) { scope = el; onBack = back; onKey = key || null; },
    // Вернуться туда, где был пульт (после вопроса «Да/Отмена»)
    state() { const s = scope, b = onBack, k = onKey, f = document.activeElement; return () => { scope = s; onBack = b; onKey = k; focus(f); }; },
    focus, first() { focus(items()[0]); }
  };
})();
