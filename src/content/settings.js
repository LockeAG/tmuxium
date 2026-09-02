// @ts-check

/* Settings, shared by the content script and the options page.
   A plain script rather than a module, because content scripts are classic
   scripts and cannot import. Both sides load this file and read the global. */

/**
 * A key plus modifiers, remembered two ways on purpose.
 *
 * `code` is the physical key. It survives macOS Option composing, where
 * Option-A gives `key: 'å'` and Option-E gives `key: 'Dead'`.
 *
 * `key` is the character on the keycap. It survives a layout where the letters
 * sit elsewhere: on AZERTY the key labelled A reports `code: 'KeyQ'`, so
 * matching on code alone would mean the prefix is on the key labelled Q.
 *
 * Either one matching is enough, which covers both.
 * @typedef {object} Prefix
 * @property {boolean} ctrl
 * @property {boolean} alt
 * @property {boolean} shift
 * @property {boolean} meta
 * @property {string} code
 * @property {string} [key] the character, when it is a plain ASCII one
 */

/**
 * The id of a prefix action. Order in `ACTIONS` is help order and conflict
 * priority: when stored data disagrees, the earlier id wins a contested key.
 * @typedef {'switcher' | 'windows' | 'last' | 'prev' | 'next' | 'call' | 'create' | 'close' | 'vim' | 'settings'} ActionId
 */

/**
 * @typedef {object} Settings
 * @property {Prefix | null} prefix null means "whatever suits this platform"
 * @property {string[]} disabled host patterns where the extension stays out
 * @property {string} search a search URL template with %s where the query goes
 * @property {Record<ActionId, string[]>} keys keys bound to each prefix action
 */

globalThis.SV_SETTINGS = (() => {
  const KEY = 'settings';

  function isMac() {
    const platform =
      /** @type {any} */ (navigator).userAgentData?.platform ?? navigator.platform ?? '';
    return /mac/i.test(platform);
  }

  /**
   * Deliberately not stored. Ctrl-A is select-all on Windows and Linux, so a
   * Mac user saving an unrelated setting must not push Ctrl-A to their PC.
   * @returns {Prefix}
   */
  function platformPrefix() {
    return isMac()
      ? { ctrl: true, alt: false, shift: false, meta: false, code: 'KeyA', key: 'a' }
      : { ctrl: false, alt: true, shift: false, meta: false, code: 'KeyA', key: 'a' };
  }

  // Apps where the browser's own editing matters more than a prefix. Documents,
  // spreadsheets and mail all use Ctrl-A for select-all, and the rest capture
  // single keys of their own. These are shown in the settings and can be
  // deleted: they are a starting point, not a policy.
  const DEFAULT_DISABLED = [
    'mail.google.com',
    'docs.google.com',
    '*.officeapps.live.com',
    '*.sharepoint.com',
    '*.office.com',
    '*.overleaf.com',
    '*.notion.so',
    '*.figma.com',
    'app.slack.com',
    'vscode.dev',
    'github.dev'
  ];

  // Presets, not a policy. Anything with %s in it works, so nobody is stuck
  // with a search engine somebody else picked.
  const ENGINES = [
    ['Google', 'https://www.google.com/search?q=%s'],
    ['DuckDuckGo', 'https://duckduckgo.com/?q=%s'],
    ['Bing', 'https://www.bing.com/search?q=%s'],
    ['Brave', 'https://search.brave.com/search?q=%s'],
    ['Kagi', 'https://kagi.com/search?q=%s'],
    ['Ecosia', 'https://www.ecosia.org/search?q=%s'],
    ['Startpage', 'https://www.startpage.com/sp/search?query=%s'],
    ['Perplexity', 'https://www.perplexity.ai/search?q=%s']
  ];

  const DEFAULT_SEARCH = ENGINES[0][1];

  // id, default keys, help text. Order is help order and conflict priority.
  // The `create` id deliberately avoids the word this project cannot ship:
  // tools/build-store.cjs fails the store build on that substring anywhere in
  // dist/, case-sensitively, since it names the page the store build drops.
  /** @type {Array<[ActionId, string[], string]>} */
  const ACTIONS = [
    ['switcher', ['o', 'w'], 'tab tree, searchable across every window'],
    ['windows', ['s'], 'the same tree, collapsed to windows'],
    ['last', ['b', 'l'], 'toggle to the last tab you were on'],
    ['prev', ['p'], 'previous tab in order'],
    ['next', ['n'], 'next tab in order'],
    ['call', ['m'], 'jump to a call, cycles if several'],
    ['create', ['c'], 'new tab'],
    ['close', ['x'], 'close tab'],
    ['vim', ['v'], 'toggle vim mode'],
    ['settings', [','], 'settings: prefix, keys and per-site opt-out']
  ];

  // Digits and `?` stay out of the registry: they are jump-to-tab and help,
  // and neither is worth rebinding.
  const FIXED_KEYS = new Set(['?', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

  /**
   * A usable template is an http(s) URL with a %s to drop the query into.
   * @param {any} input
   * @returns {string}
   */
  function normaliseSearch(input) {
    const text = String(input ?? '').trim();
    if (!text.includes('%s')) return DEFAULT_SEARCH;
    try {
      const url = new URL(text.replace('%s', 'q'));
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_SEARCH;
      return text;
    } catch {
      return DEFAULT_SEARCH;
    }
  }

  /** @param {string} template @param {string} query */
  function searchUrl(template, query) {
    return normaliseSearch(template).replace('%s', encodeURIComponent(query));
  }

  /** @param {string} template */
  function engineName(template) {
    const preset = ENGINES.find(([, url]) => url === template);
    return preset ? preset[0] : new URL(normaliseSearch(template).replace('%s', 'q')).hostname;
  }

  /** @returns {Settings} */
  function defaults() {
    return { prefix: null, disabled: [...DEFAULT_DISABLED], search: DEFAULT_SEARCH, keys: normaliseKeys(undefined) };
  }

  /** @param {Settings} settings @returns {Prefix} */
  function effectivePrefix(settings) {
    return settings.prefix ?? platformPrefix();
  }

  const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

  /**
   * Reduce a line to a bare lowercase host. Accepts what people actually
   * paste: a full URL, a host with a port, a trailing dot, an IDN. Anything
   * unusable becomes '' and is dropped.
   * @param {string} input
   */
  function normaliseHost(input) {
    let text = String(input ?? '').trim().toLowerCase();
    if (!text) return '';

    let wildcard = false;
    if (text.startsWith('*.')) {
      wildcard = true;
      text = text.slice(2);
    }

    try {
      // Parsing punycodes an IDN, drops the port, path and scheme, and gives
      // back exactly what location.hostname will be compared against.
      const url = new URL(text.includes('://') ? text : `http://${text}`);
      const host = url.hostname.replace(/\.$/, '');
      // `*`, `.com` and other things that parse but can never equal a hostname
      // must be rejected here, or they save quietly and match nothing forever.
      if (!HOST.test(host)) return '';
      if (!host.includes('.') && host !== 'localhost') return '';
      return wildcard ? `*.${host}` : host;
    } catch {
      return '';
    }
  }

  /**
   * Storage is shared across machines and versions, so treat what comes back
   * as untrusted. A malformed value must not throw on every keystroke.
   * @param {any} raw
   * @returns {Settings}
   */
  function normalise(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};

    /** @type {Prefix | null} */
    let prefix = null;
    const p = source.prefix;
    if (p && typeof p === 'object' && typeof p.code === 'string' && p.code) {
      prefix = {
        ctrl: Boolean(p.ctrl),
        alt: Boolean(p.alt),
        shift: Boolean(p.shift),
        meta: Boolean(p.meta),
        code: p.code,
        ...(isPlainKey(p.key) ? { key: String(p.key).toLowerCase() } : {})
      };
      // A prefix with no modifier would swallow a plain letter everywhere.
      if (!prefix.ctrl && !prefix.alt && !prefix.meta) prefix = null;
    }

    const disabled = Array.isArray(source.disabled)
      ? source.disabled.map(normaliseHost).filter(Boolean)
      : [];

    return { prefix, disabled, search: normaliseSearch(source.search), keys: normaliseKeys(source.keys) };
  }

  /**
   * Every action gets a list of currently bound keys: filled from its own
   * defaults where nothing usable was stored, and with a key already claimed
   * by an earlier action, in registry order, dropped from a later one. An
   * action left with nothing takes any of its own defaults not already
   * spoken for; failing that it stays empty, shown as unbound. Storage is
   * shared across machines and versions, so nothing here may throw.
   * @param {any} input
   * @returns {Record<ActionId, string[]>}
   */
  function normaliseKeys(input) {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const claimed = new Set();
    /** @type {Record<string, string[]>} */
    const result = {};

    for (const [id, fallback] of ACTIONS) {
      const stored = raw[id];
      const requested = Array.isArray(stored)
        ? stored.filter((key) => isPlainKey(key) && !/\s/.test(key) && !FIXED_KEYS.has(key))
        : fallback;

      let keys = [...new Set(requested.filter((key) => !claimed.has(key)))];
      if (!keys.length) keys = fallback.filter((key) => !claimed.has(key));

      keys.forEach((key) => claimed.add(key));
      result[id] = keys;
    }

    return /** @type {Record<ActionId, string[]>} */ (result);
  }

  /**
   * The rule `normaliseKeys` applies to one candidate, so the options page can
   * show the same verdict before save rather than after.
   * @param {Record<ActionId, string[]>} keys the keys as they stand, before this change
   * @param {ActionId} actionId the action being bound
   * @param {string} key
   * @returns {string | null} null when the key may be bound
   */
  function keyProblem(keys, actionId, key) {
    if (!isPlainKey(key) || /\s/.test(key)) return 'invalid';
    if (FIXED_KEYS.has(key)) return 'fixed';
    for (const [id, , description] of ACTIONS) {
      if (id === actionId) continue;
      if ((keys[id] ?? []).includes(key)) return `already used by ${description}`;
    }
    return null;
  }

  /**
   * @param {Record<ActionId, string[]>} keys
   * @param {string} key
   * @returns {ActionId | null}
   */
  function actionFor(keys, key) {
    for (const [id] of ACTIONS) {
      if ((keys[id] ?? []).includes(key)) return id;
    }
    return null;
  }

  /**
   * Reads sync, falls back to a local mirror, and reports failure rather than
   * pretending the blocklist is empty. A site the user switched off must not
   * start firing because storage hiccupped.
   * @returns {Promise<Settings | null>}
   */
  async function load() {
    try {
      // Sync is authoritative when it answers, including when it answers that
      // there is nothing stored. Refresh the mirror while we are here, so a
      // change made on another machine cannot leave a stale copy behind.
      const stored = await chrome.storage.sync.get(KEY);
      const settings = stored && KEY in stored ? normalise(stored[KEY]) : defaults();
      chrome.storage.local.set({ [KEY]: settings }).catch(() => {});
      return settings;
    } catch {
      // fall through to the mirror
    }

    try {
      const mirrored = await chrome.storage.local.get(KEY);
      if (mirrored && KEY in mirrored) return normalise(mirrored[KEY]);
    } catch {
      // nothing to fall back on
    }

    // Sync failed and there is no mirror, so we cannot know what is on the
    // blocklist. Say so rather than pretend it is empty.
    return null;
  }

  /** @param {Settings} settings */
  async function save(settings) {
    const clean = normalise(settings);
    await chrome.storage.sync.set({ [KEY]: clean });
    // Mirror locally so a sync failure later cannot lose the blocklist.
    await chrome.storage.local.set({ [KEY]: clean }).catch(() => {});
    return clean;
  }

  /**
   * Exact modifier match, so Ctrl-A never fires on Ctrl-Shift-A.
   * @param {Prefix} prefix
   * @param {KeyboardEvent} event
   */
  function matches(prefix, event) {
    const modifiers =
      event.ctrlKey === prefix.ctrl &&
      event.altKey === prefix.alt &&
      event.metaKey === prefix.meta &&
      event.shiftKey === prefix.shift;
    if (!modifiers) return false;

    // The label wins whenever the layout produces one, and the position is
    // only a fallback. Accepting either outright matched two different keys on
    // AZERTY: the key labelled A by its character, and the key sitting where
    // QWERTY has A, which is labelled Q, by its code. Ctrl-Q would have armed
    // the prefix and eaten the next keystroke.
    if (prefix.key && isPlainKey(event.key)) {
      return String(event.key).toLowerCase() === prefix.key;
    }
    return event.code === prefix.code;
  }

  /**
   * Patterns are hosts: `mail.google.com`, or `*.example.com` for the domain
   * and everything under it.
   * @param {string[]} patterns
   * @param {string} hostname
   */
  function disabledFor(patterns, hostname) {
    const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
    if (!host) return false;
    return patterns.some((pattern) => {
      if (!pattern) return false;
      if (pattern.startsWith('*.')) {
        const domain = pattern.slice(2);
        return host === domain || host.endsWith(`.${domain}`);
      }
      return host === pattern;
    });
  }

  /** A single ASCII character, the only kind worth comparing across layouts. */
  const isPlainKey = (value) => typeof value === 'string' && /^[\x20-\x7e]$/.test(value);

  /**
   * The character an action key stands for. Latin layouts give it directly, so
   * `w` means window whatever the keycaps say. A non-Latin layout gives no
   * Latin character at all, so fall back to the physical key, which is what is
   * usually printed on the keycap next to the local letter.
   * @param {string} key
   * @param {string} code
   * @param {boolean} [shift] case matters: H is history, h is scroll left
   */
  function actionKey(key, code, shift) {
    if (isPlainKey(key)) return key;
    if (typeof code !== 'string') return key;
    if (code.startsWith('Key')) {
      const letter = code.slice(3);
      return shift ? letter.toUpperCase() : letter.toLowerCase();
    }
    if (code.startsWith('Digit')) return code.slice(5);
    const punctuation = { Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'" };
    return punctuation[code] ?? key;
  }

  /** @param {string} code */
  function keyLabel(code) {
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return code;
  }

  /** @param {Prefix} prefix */
  function label(prefix) {
    const parts = [];
    if (prefix.ctrl) parts.push('Ctrl');
    if (prefix.alt) parts.push(isMac() ? 'Option' : 'Alt');
    if (prefix.shift) parts.push('Shift');
    if (prefix.meta) parts.push(isMac() ? 'Cmd' : 'Win');
    // Show the keycap where we know it, since that is what the user pressed.
    parts.push(prefix.key ? prefix.key.toUpperCase() : keyLabel(prefix.code));
    return parts.join('-');
  }

  // Chrome handles these itself and ignores preventDefault, so binding one
  // would close or open a tab on every prefix press.
  const RESERVED = ['KeyW', 'KeyT', 'KeyN', 'KeyQ', 'KeyP', 'Tab'];

  /** @param {Prefix} prefix */
  function isReserved(prefix) {
    if (prefix.alt) return false;
    return (prefix.ctrl || prefix.meta) && RESERVED.includes(prefix.code);
  }

  const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS|CapsLock)/;

  /**
   * Turn a keypress into a prefix, or null if it is only modifiers or has none.
   * @param {KeyboardEvent} event
   * @returns {Prefix | null}
   */
  function fromEvent(event) {
    if (!event.code || MODIFIER_CODES.test(event.code)) return null;
    if (!event.ctrlKey && !event.altKey && !event.metaKey) return null;
    return {
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
      code: event.code,
      ...(isPlainKey(event.key) ? { key: event.key.toLowerCase() } : {})
    };
  }

  return {
    KEY, DEFAULT_DISABLED, ENGINES, DEFAULT_SEARCH, ACTIONS, FIXED_KEYS, defaults, normalise,
    normaliseHost, normaliseSearch, searchUrl, engineName, platformPrefix, effectivePrefix,
    actionKey, keyProblem, actionFor, load, save, matches, disabledFor, label, fromEvent,
    isReserved, isMac, MODIFIER_CODES
  };
})();
