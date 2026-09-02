// @ts-check

/* Key capture and the mode machine.

   off  --(C-a)-------> armed --(key)--> off
   off  --(C-a v)-----> vim
   vim  --(C-a v|Esc)-> off
   vim  --(C-a)-------> armed --(key)--> vim

   The prefix is caught here, in the page. There is no browser-level shortcut:
   binding one would make Chrome swallow Ctrl-A before any page could see it.

   Wrapped in an IIFE because the service worker may inject this file into a
   tab that already has it. Re-running bare top-level `const` would throw. */

(() => {
  // A previous instance may still be here: injected twice, or orphaned by an
  // extension reload. Either way, retire it and take over.
  globalThis.__TMUXIUM__?.retire?.();

  const SCROLL_STEP = 64;
  const UI = globalThis.SV_UI;
  const CONFIG = globalThis.SV_SETTINGS;

  let settings = CONFIG.defaults();
  let prefix = CONFIG.platformPrefix();
  // Assume disabled until the settings arrive, and stay that way if they never
  // do. A site the user switched off must never fire because storage hiccupped.
  let blocked = true;
  // Rebuilt whenever settings change, so a live rebind takes effect on the
  // next keypress without anything extra to wire up.
  /** @type {Map<string, ActionId>} */
  let keyToAction = buildKeyToAction(settings.keys);

  /** @param {Record<ActionId, string[]>} keys @returns {Map<string, ActionId>} */
  function buildKeyToAction(keys) {
    const map = new Map();
    for (const [id, list] of Object.entries(keys)) {
      for (const key of list) map.set(key, /** @type {ActionId} */ (id));
    }
    return map;
  }

  /** @type {'off' | 'vim'} */
  let mode = 'off';
  let armed = false;
  let pendingG = false;
  // Deliberately untyped: the DOM lib and Node's types disagree about what a
  // timer handle is, and the handle is only ever passed straight back.
  /** @type {any} */
  let gTimer = null;
  let retired = false;

  // chrome.runtime.id goes undefined once the extension is reloaded, which
  // orphans every content script already in a page.
  function contextAlive() {
    return !retired && Boolean(chrome.runtime?.id);
  }

  function retire() {
    if (retired) return;
    retired = true;
    window.removeEventListener('keydown', onKeyDown, true);
    UI.closeSwitcher();
    UI.closeHints();
    UI.closeFind();
    UI.closeHelp();
    UI.setIndicator(null);
    try {
      // Throws if the extension was reloaded out from under us, which is
      // exactly when retire() runs, so it goes last and it goes in a try.
      chrome.storage.onChanged.removeListener(onSettingsChanged);
    } catch {
      // nothing left to detach from
    }
  }

  function send(message) {
    // sendMessage throws synchronously on an invalidated context, so catching
    // on the returned promise is not enough.
    if (!contextAlive()) {
      retire();
      return Promise.resolve(null);
    }
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch {
      retire();
      return Promise.resolve(null);
    }
  }

  function paint() {
    UI.setIndicator(armed ? 'armed' : mode === 'vim' ? 'vim' : null);
  }

  // No timeout, same as tmux. The prefix stays armed until a key arrives, and
  // the indicator is what tells you it is waiting.
  function setArmed(value, notify = false) {
    armed = value;
    if (notify) send({ type: value ? 'arm' : 'disarm' });
    paint();
  }

  function setMode(next) {
    mode = next;
    if (next !== 'vim') {
      UI.closeHints();
      UI.closeFind();
    }
    paint();
  }

  /* Focus */

  /** @returns {HTMLElement | null} */
  function deepActiveElement() {
    let node = document.activeElement;
    while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
    return /** @type {HTMLElement | null} */ (node);
  }

  const NON_TEXT_INPUTS = new Set([
    'button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'image', 'color', 'range'
  ]);

  function isEditable(node) {
    if (!node) return false;
    if (node.isContentEditable) return true;
    const tag = node.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((node.type || 'text').toLowerCase());
    return node.getAttribute?.('role') === 'textbox';
  }

  /* C-a C-a: emulate the macOS line-start binding we took over. A synthetic
     KeyboardEvent is untrusted and will not move the caret, so do it by hand. */

  function moveToLineStart() {
    const node = deepActiveElement();
    if (!node) return;

    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      try {
        const caret = node.selectionStart ?? 0;
        const newline = node.value.lastIndexOf('\n', caret - 1);
        const target = newline === -1 ? 0 : newline + 1;
        node.setSelectionRange(target, target);
      } catch {
        // Input types like email and number reject setSelectionRange.
      }
      return;
    }

    if (node.isContentEditable) {
      getSelection()?.modify?.('move', 'backward', 'lineboundary');
    }
  }

  /* Scrolling */

  function scroller() {
    let node = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    while (node && node !== document.body && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) return node;
      node = node.parentElement;
    }
    return document.scrollingElement ?? document.documentElement;
  }

  function scrollBy(x, y) {
    scroller().scrollBy({ left: x, top: y, behavior: 'instant' });
  }

  function scrollTo(where) {
    const target = scroller();
    target.scrollTo({ top: where === 'bottom' ? target.scrollHeight : 0, behavior: 'instant' });
  }

  /* Hints */

  function activate(element, newTab) {
    if (newTab) {
      const href = element.getAttribute?.('href');
      if (href) {
        send({ type: 'openUrl', url: new URL(href, location.href).href });
        return;
      }
    }
    if (isEditable(element)) {
      element.focus();
      return;
    }
    element.click();
  }

  function startHints(newTab) {
    UI.openHints((element) => activate(element, newTab));
  }

  /* Vim keys */

  function handleVimKey(event) {
    // On a Cyrillic layout `event.key` is 'ц' where the keycap says W, so fall
    // back to the physical key rather than leaving vim mode dead.
    const key = CONFIG.actionKey(event.key, event.code, event.shiftKey);

    if (pendingG) {
      clearTimeout(gTimer);
      pendingG = false;
      if (key === 'g') {
        scrollTo('top');
        return true;
      }
    }

    switch (key) {
      case 'h': scrollBy(-SCROLL_STEP, 0); return true;
      case 'l': scrollBy(SCROLL_STEP, 0); return true;
      case 'j': scrollBy(0, SCROLL_STEP); return true;
      case 'k': scrollBy(0, -SCROLL_STEP); return true;
      case 'd': scrollBy(0, innerHeight / 2); return true;
      case 'u': scrollBy(0, -innerHeight / 2); return true;
      case 'G': scrollTo('bottom'); return true;
      case 'g':
        pendingG = true;
        gTimer = setTimeout(() => { pendingG = false; }, 700);
        return true;
      case 'f': startHints(false); return true;
      case 'F': startHints(true); return true;
      case '/': UI.openFind(() => paint()); return true;
      case 'n': UI.repeatFind(UI.lastFindTerm(), false); return true;
      case 'N': UI.repeatFind(UI.lastFindTerm(), true); return true;
      case 'H': history.back(); return true;
      case 'L': history.forward(); return true;
      case 'r': location.reload(); return true;
      default: return false;
    }
  }

  /* Key capture */

  const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

  // Control-A is not a macOS menu accelerator, so unlike a Command shortcut the
  // page can claim it before anything else does. The combination is
  // configurable, because Ctrl-A is select-all off macOS.
  /** @param {KeyboardEvent} event */
  function isPrefix(event) {
    return CONFIG.matches(prefix, event);
  }

  function onKeyDown(event) {
    // Only real keystrokes. A page can dispatch KeyboardEvents at will, and
    // without this it can arm the prefix and run any action, closing your tab
    // or spawning tabs with no interaction from you. isTrusted cannot be faked.
    if (!event.isTrusted) return;

    // Switched off for this site in the options page.
    if (blocked) return;

    // An orphan must give the page its keys back rather than swallow them.
    if (!contextAlive()) {
      retire();
      return;
    }
    if (MODIFIERS.has(event.key)) return;

    if (UI.helpOpen()) {
      event.preventDefault();
      event.stopPropagation();
      UI.closeHelp();
      return;
    }

    // Our own overlays own their input. Let the event reach them.
    if (UI.isSwitcherOpen() || UI.findOpen()) return;

    if (isPrefix(event)) {
      event.preventDefault();
      event.stopPropagation();
      if (armed) {
        // Second press. Give back the line-start binding we took over.
        setArmed(false, true);
        moveToLineStart();
      } else {
        setArmed(true, true);
      }
      return;
    }

    if (UI.hintsOpen()) {
      const result = UI.feedHint(CONFIG.actionKey(event.key, event.code, event.shiftKey));
      if (result !== 'ignored') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    if (armed) {
      // Ctrl is allowed, because C-a C-o is a real binding. Alt and Cmd are
      // not: on macOS an armed Option-X produces '≈', which falls back to the
      // physical key and would close the tab. Disarm and let it through.
      if (event.altKey || event.metaKey) {
        setArmed(false, true);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setArmed(false);
      if (event.key === 'Escape') {
        send({ type: 'disarm' });
        return;
      }

      const key = CONFIG.actionKey(event.key, event.code, event.shiftKey);

      // Help is drawn in the page, so it needs no round trip.
      if (key === '?') {
        send({ type: 'disarm' });
        UI.openHelp(CONFIG.label(prefix));
        return;
      }

      // Digits are fixed, never in the registry: jump straight by position.
      if (/^[1-9]$/.test(key)) {
        send({ type: 'action', action: 'jump', index: Number(key) }).then((response) => {
          if (response?.mode) setMode(response.mode);
        });
        return;
      }

      const action = keyToAction.get(key);
      if (!action) {
        send({ type: 'disarm' });
        return;
      }
      send({ type: 'action', action }).then((response) => {
        if (response?.mode) setMode(response.mode);
      });
      return;
    }

    if (mode !== 'vim') return;

    // Suspend the keymap while a text field has focus. Without this, typing in
    // any search box scrolls the page instead.
    if (isEditable(deepActiveElement())) return;

    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'Escape') {
      // No preventDefault: pages use Escape to close their own things.
      setMode('off');
      send({ type: 'setMode', mode: 'off' });
      return;
    }

    if (handleVimKey(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  window.addEventListener('keydown', onKeyDown, true);

  /* Messages from the service worker */

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Always answer. The service worker uses a null reply to detect a tab with
    // no content script, which is how it knows to inject one.
    sendResponse({ ok: true });
    switch (message.type) {
      case 'switcher':
        // A reply can still land after the site was added to the blocklist.
        if (blocked) break;
        setArmed(false);
        UI.openSwitcher(
          { ...message, prefixLabel: CONFIG.label(prefix) },
          (target) => send({ type: 'pick', ...target }),
          (tabId) => send({ type: 'close', tabId })
        );
        break;
    }
  });

  /* Restore mode after a navigation kills this script. */

  // Later settings always win over an earlier in-flight read.
  let settingsGeneration = 0;

  /**
   * @param {Settings | null} next null means storage could not be read, so
   *   stay blocked rather than guess that nothing is on the list.
   * @param {number} generation
   */
  function applySettings(next, generation) {
    if (generation < settingsGeneration || retired) return;
    settingsGeneration = generation;

    if (!next) {
      // Storage could not be read at all, so we cannot know whether this site
      // is on the list. Stay out, and clean up as if it were.
      blocked = true;
      standDown();
      return;
    }

    settings = next;
    prefix = CONFIG.effectivePrefix(next);
    blocked = CONFIG.disabledFor(next.disabled, location.hostname);
    keyToAction = buildKeyToAction(next.keys);

    if (blocked) standDown();
    else handshake();
  }

  /** Leave nothing behind on a site we do not serve. */
  function standDown() {
    UI.closeSwitcher();
    UI.closeHints();
    UI.closeFind();
    UI.closeHelp();
    UI.setIndicator(null);
    armed = false;
    mode = 'off';
    // Tell the worker too, or the toolbar badge keeps claiming this tab is armed.
    send({ type: 'setMode', mode: 'off' });
  }

  // The handshake has to wait for the settings, or a warm worker answers first
  // and its reply is dropped while `blocked` is still true.
  let greeted = false;

  function handshake() {
    if (greeted || blocked || retired) return;
    greeted = true;
    send({ type: 'ready' }).then((response) => {
      if (blocked || retired) return;
      if (response?.mode) setMode(response.mode);
    });
  }

  function reload() {
    const generation = ++settingsGeneration;
    CONFIG.load().then((next) => applySettings(next, generation));
  }

  /** @param {{[key: string]: chrome.storage.StorageChange}} changes */
  function onSettingsChanged(changes) {
    if (!changes[CONFIG.KEY]) return;
    reload();
  }

  chrome.storage.onChanged.addListener(onSettingsChanged);
  reload();

  globalThis.__TMUXIUM__ = { retire };
  console.log('[tmuxium] content script ready');
})();
