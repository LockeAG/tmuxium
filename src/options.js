// @ts-check

const CONFIG = globalThis.SV_SETTINGS;

// The store build strips the search section, since it only serves the New Tab
// Page. Everything that touches it has to tolerate its absence, or the whole
// script dies on the first line and takes Save and the blocklist with it.
const engineSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('engine'));
const customInput = /** @type {HTMLInputElement | null} */ (document.getElementById('custom'));
const prefixButton = /** @type {HTMLButtonElement} */ (document.getElementById('prefix'));
const prefixNote = /** @type {HTMLElement} */ (document.getElementById('prefix-note'));
const disabledBox = /** @type {HTMLTextAreaElement} */ (document.getElementById('disabled'));
const statusEl = /** @type {HTMLElement} */ (document.getElementById('status'));

/** @type {Settings} */
let current = CONFIG.defaults();
let capturing = false;
// Saving on top of settings we failed to read would wipe the real ones and
// push the wipe to every machine.
let degraded = false;

/* Keys: one row per registry action, built once so a click can keep focus
   through its own re-render, the same problem the prefix button does not
   have because it is a single persistent element. */

const keysContainer = document.getElementById('keys');
/** @type {ActionId | null} action being captured, or null */
let capturingKey = null;
/** @type {Record<string, string>} the last problem shown per action, if any */
const keyNotes = {};

/** @type {Array<{ id: ActionId, button: HTMLButtonElement, note: HTMLElement }>} */
const keyRows = CONFIG.ACTIONS.map(([id, , description]) => {
  const row = document.createElement('div');
  row.className = 'key-row';

  const label = document.createElement('span');
  label.className = 'key-desc';
  label.textContent = description;

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.action = id;
  button.setAttribute('aria-label', `${description}, click then press a key`);

  const note = document.createElement('span');
  note.className = 'note';

  button.addEventListener('click', () => {
    capturingKey = id;
    keyNotes[id] = '';
    renderKeys();
  });

  button.addEventListener('blur', () => {
    if (capturingKey !== id) return;
    capturingKey = null;
    renderKeys();
  });

  button.addEventListener('keydown', (event) => {
    if (capturingKey !== id) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      capturingKey = null;
      renderKeys();
      return;
    }
    // Shift alone on the way to Shift-X must not flash "invalid" before the
    // X lands, the same guard main.js applies while armed.
    if (CONFIG.MODIFIER_CODES.test(event.code)) return;

    const key = CONFIG.actionKey(event.key, event.code, event.shiftKey);
    const problem = CONFIG.keyProblem(current.keys, id, key);
    // Stay in capture and say why, the way the prefix button does for a key
    // Chrome keeps, so the next press can be the right one.
    if (problem) {
      keyNotes[id] = problem;
      renderKeys();
      return;
    }

    current = { ...current, keys: { ...current.keys, [id]: [key] } };
    capturingKey = null;
    keyNotes[id] = '';
    renderKeys();
  });

  row.append(label, button, note);
  keysContainer?.append(row);
  return { id, button, note };
});

function renderKeys() {
  for (const { id, button, note } of keyRows) {
    const bound = current.keys[id] ?? [];
    button.textContent = capturingKey === id
      ? 'press a key…'
      : bound.length ? bound.join(' / ') : '(unbound)';
    note.textContent = keyNotes[id] ?? '';
  }
}

function renderEngine() {
  if (!engineSelect || !customInput) return;
  if (!engineSelect.options.length) {
    for (const [name, url] of CONFIG.ENGINES) engineSelect.add(new Option(name, url));
    engineSelect.add(new Option('Custom', 'custom'));
  }
  const preset = CONFIG.ENGINES.some(([, url]) => url === current.search);
  engineSelect.value = preset ? current.search : 'custom';
  customInput.hidden = preset;
  if (!preset) customInput.value = current.search;
}

function render() {
  renderEngine();
  renderKeys();
  const prefix = CONFIG.effectivePrefix(current);
  prefixButton.textContent = capturing ? 'press a key…' : CONFIG.label(prefix);

  const save = /** @type {HTMLButtonElement} */ (document.getElementById('save'));
  save.disabled = degraded;
  save.style.opacity = degraded ? '0.4' : '';
  save.style.cursor = degraded ? 'not-allowed' : 'pointer';

  if (degraded) {
    prefixNote.textContent = 'settings could not be read, so saving is off';
  } else if (capturing) {
    prefixNote.textContent = 'Esc to cancel';
  } else if (!current.prefix) {
    // Left alone, the prefix follows each machine: Ctrl-A on macOS where it is
    // free, Alt-A elsewhere where Ctrl-A is select-all.
    prefixNote.textContent = 'default for this platform, and not synced';
  } else if (!CONFIG.isMac() && current.prefix.ctrl && !current.prefix.alt &&
             !current.prefix.meta && current.prefix.code === 'KeyA') {
    prefixNote.textContent = 'warning: this is select-all on Windows and Linux';
  } else {
    prefixNote.textContent = 'set explicitly, so it syncs to all your machines';
  }
}

/** @param {string} message */
function say(message) {
  statusEl.textContent = message;
  setTimeout(() => {
    if (statusEl.textContent === message) statusEl.textContent = '';
  }, 2500);
}

prefixButton.addEventListener('click', () => {
  capturing = true;
  render();
  prefixButton.focus();
});

prefixButton.addEventListener('blur', () => {
  if (!capturing) return;
  capturing = false;
  render();
});

prefixButton.addEventListener('keydown', (event) => {
  if (!capturing) return;
  event.preventDefault();
  event.stopPropagation();

  if (event.key === 'Escape') {
    capturing = false;
    render();
    return;
  }

  const prefix = CONFIG.fromEvent(event);
  if (!prefix) return; // modifiers alone, or nothing held down

  if (CONFIG.isReserved(prefix)) {
    // Chrome keeps these for itself and ignores preventDefault, so this would
    // close or open a tab every time you pressed the prefix.
    prefixNote.textContent = `${CONFIG.label(prefix)} belongs to Chrome, pick another`;
    return;
  }

  current = { ...current, prefix };
  capturing = false;
  render();
});

engineSelect?.addEventListener('change', () => {
  if (!customInput) return;
  if (engineSelect.value === 'custom') {
    customInput.hidden = false;
    customInput.focus();
    return;
  }
  current = { ...current, search: engineSelect.value };
  render();
});

customInput?.addEventListener('input', () => {
  current = { ...current, search: customInput.value };
});

document.getElementById('save')?.addEventListener('click', async () => {
  if (degraded) return;
  const typed = disabledBox.value.split('\n').map((line) => line.trim()).filter(Boolean);

  const wanted = { ...current, disabled: typed };
  try {
    // save() normalises: a pasted URL, a port, a trailing dot or an IDN all
    // become the bare host the content script will actually compare against.
    current = await CONFIG.save(wanted);
  } catch (error) {
    // Sync has an 8 KB per-item cap and a write rate limit. Silence here would
    // leave you believing a blocklist was saved when it was not.
    say(`not saved: ${error instanceof Error ? error.message : 'storage refused it'}`);
    return;
  }

  disabledBox.value = current.disabled.join('\n');
  render();

  const dropped = typed.length - current.disabled.length;
  // Report on what was actually stored, not on a field that may be hidden or
  // hold a stale value from a choice the user has since changed.
  if (dropped > 0) say(`saved, ${dropped} line(s) were not usable hosts`);
  else if (wanted.search !== current.search) say('saved, but that search URL was unusable');
  else say('saved');
});

document.getElementById('reset')?.addEventListener('click', async () => {
  try {
    current = await CONFIG.save(CONFIG.defaults());
  } catch {
    say('not saved: storage refused it');
    return;
  }
  degraded = false;
  // A note from before the reset would now describe a key nobody is trying
  // to bind any more.
  for (const id of Object.keys(keyNotes)) delete keyNotes[id];
  // defaults() ships a blocklist, so an empty box here would lie about what is
  // now stored and synced to every machine.
  disabledBox.value = current.disabled.join('\n');
  render();
  say('reset');
});

/** @type {HTMLElement} */ (document.getElementById('version')).textContent =
  `v${chrome.runtime.getManifest().version}`;

CONFIG.load().then((loaded) => {
  degraded = loaded === null;
  current = loaded ?? CONFIG.defaults();
  disabledBox.value = current.disabled.join('\n');
  render();
  if (degraded) say('could not read your settings, reset to start again');
});
