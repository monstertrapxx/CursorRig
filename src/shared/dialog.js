// A small in-page dialog (Electron has no prompt()). Needs the #dlg markup from the page.
// ask('Title', { value: 'text' | null, choices: [{ label, key, depth }], buttons: [[label, key], ...] }) -> { key, text }
const $ = (s) => document.querySelector(s);
export function ask(title, { value = null, choices = null, buttons = [['Cancel', 'cancel'], ['OK', 'ok']] } = {}) {
  return new Promise((resolve) => {
    const back = $('#dlg'), input = $('#dlg-i'), row = $('#dlg-b'), list = $('#dlg-l');
    $('#dlg-t').textContent = title;
    input.hidden = value === null; input.value = value ?? '';
    list.innerHTML = ''; list.hidden = !choices;
    const done = (key) => { back.hidden = true; $('#dlg-form').onsubmit = null; back.onkeydown = null; resolve({ key, text: input.value.trim() }); };
    for (const c of choices || []) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'choice'; b.style.paddingLeft = 10 + (c.depth || 0) * 16 + 'px';
      b.textContent = c.label; if (c.on) b.classList.add('on'); b.onclick = () => done(c.key); list.append(b);
    }
    row.innerHTML = '';
    buttons.forEach(([label, key], k) => {
      const last = k === buttons.length - 1 && !choices;
      const b = document.createElement('button'); b.type = last ? 'submit' : 'button';
      b.className = 'btn' + (last ? ' primary' : ''); b.textContent = label;
      if (!last) b.onclick = () => done(key);
      row.append(b);
    });
    $('#dlg-form').onsubmit = (e) => { e.preventDefault(); done(buttons[buttons.length - 1][1]); };
    back.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') done('cancel'); };
    back.hidden = false;
    (value === null ? row.lastChild : input).focus(); input.select?.();
  });
}
