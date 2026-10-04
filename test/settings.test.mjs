import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// settings.js is a classic script for content-script and options-page use, so
// it has no exports. Evaluate it against a stub global and read what it hangs
// off globalThis, which is exactly how both callers get at it.
/**
 * @param {{ mac?: boolean, sync?: any, local?: any }} [options]
 */
function loadSettings({ mac = true, sync, local } = {}) {
  const scope = {
    navigator: { platform: mac ? 'MacIntel' : 'Win32' },
    URL,
    chrome: {
      storage: {
        sync: sync ?? { get: async () => ({}), set: async () => {} },
        local: local ?? { get: async () => ({}), set: async () => {} }
      }
    }
  };
  scope.globalThis = scope;
  const source = readFileSync(new URL('../src/content/settings.js', import.meta.url), 'utf8');
  new Function('globalThis', 'navigator', 'chrome', 'URL', source)(
    scope, scope.navigator, scope.chrome, URL
  );
  return scope.SV_SETTINGS;
}

const press = (over = {}) => ({
  code: 'KeyA', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...over
});

test('the platform default avoids select-all off macOS', () => {
  assert.equal(loadSettings({ mac: true }).platformPrefix().ctrl, true);
  assert.equal(loadSettings({ mac: false }).platformPrefix().ctrl, false);
  assert.equal(loadSettings({ mac: false }).platformPrefix().alt, true);
});

test('an unset prefix is not stored, so it stays per-machine', () => {
  const S = loadSettings();
  assert.equal(S.defaults().prefix, null);
  assert.deepEqual(S.effectivePrefix(S.defaults()), S.platformPrefix());
});

test('every shipped default is a host the matcher can actually use', () => {
  const S = loadSettings();
  for (const pattern of S.DEFAULT_DISABLED) {
    assert.equal(S.normaliseHost(pattern), pattern, `default must survive normalising: ${pattern}`);
  }
  // Spot-check that they do what the list claims.
  const list = S.defaults().disabled;
  assert.equal(S.disabledFor(list, 'docs.google.com'), true);
  assert.equal(S.disabledFor(list, 'excel.officeapps.live.com'), true);
  assert.equal(S.disabledFor(list, 'acme.sharepoint.com'), true);
  assert.equal(S.disabledFor(list, 'www.notion.so'), true);
  assert.equal(S.disabledFor(list, 'github.com'), false, 'must not swallow ordinary sites');
  assert.equal(S.disabledFor(list, 'news.ycombinator.com'), false);
});

test('deleting every default sticks, rather than reappearing', async () => {
  const stored = { settings: { prefix: null, disabled: [] } };
  const S = loadSettings({
    sync: { get: async () => stored, set: async () => {} },
    local: { get: async () => ({}), set: async () => {} }
  });
  assert.deepEqual((await S.load()).disabled, [], 'an explicit empty list is respected');
});

test('the prefix matches modifiers exactly', () => {
  const S = loadSettings();
  const prefix = { ctrl: true, alt: false, shift: false, meta: false, code: 'KeyA' };

  assert.equal(S.matches(prefix, press({ ctrlKey: true })), true);
  assert.equal(S.matches(prefix, press({ ctrlKey: true, shiftKey: true })), false);
  assert.equal(S.matches(prefix, press({ ctrlKey: true, altKey: true })), false);
  assert.equal(S.matches(prefix, press({ code: 'KeyB', ctrlKey: true })), false);
});

test('the prefix fires on either the position or the keycap', () => {
  const S = loadSettings();
  const prefix = { ctrl: true, alt: false, shift: false, meta: false, code: 'KeyA', key: 'a' };
  const mods = { ctrlKey: true, altKey: false, metaKey: false, shiftKey: false };

  assert.equal(S.matches(prefix, { key: 'a', code: 'KeyA', ...mods }), true, 'QWERTY');
  // AZERTY: the key labelled A sits where QWERTY has Q.
  assert.equal(S.matches(prefix, { key: 'a', code: 'KeyQ', ...mods }), true, 'AZERTY, by keycap');
  // Cyrillic: no Latin character at all, so only the position can match.
  assert.equal(S.matches(prefix, { key: 'ф', code: 'KeyA', ...mods }), true, 'Cyrillic, by position');
  // macOS Option composing: the character is useless, the position is not.
  assert.equal(S.matches(prefix, { key: 'å', code: 'KeyA', ...mods }), true, 'Option composed');

  assert.equal(S.matches(prefix, { key: 'b', code: 'KeyB', ...mods }), false);
  assert.equal(S.matches(prefix, { key: 'a', code: 'KeyA', ...mods, shiftKey: true }), false);
});

test('exactly one physical key arms the prefix on any layout', () => {
  const S = loadSettings();
  const prefix = { ctrl: true, alt: false, shift: false, meta: false, code: 'KeyA', key: 'a' };
  const mods = { ctrlKey: true, altKey: false, metaKey: false, shiftKey: false };

  assert.equal(S.matches(prefix, { key: 'a', code: 'KeyA', ...mods }), true, 'QWERTY');
  // AZERTY: the key labelled A reports code KeyQ, and must match by label.
  assert.equal(S.matches(prefix, { key: 'a', code: 'KeyQ', ...mods }), true, 'AZERTY label');
  // The key sitting where QWERTY has A is labelled Q there, and must NOT match,
  // or Ctrl-Q silently arms the prefix and eats the next keystroke.
  assert.equal(S.matches(prefix, { key: 'q', code: 'KeyA', ...mods }), false, 'AZERTY Ctrl-Q');
  // No Latin character at all, so position is the only signal left.
  assert.equal(S.matches(prefix, { key: 'ф', code: 'KeyA', ...mods }), true, 'Cyrillic');
  assert.equal(S.matches(prefix, { key: 'я', code: 'KeyQ', ...mods }), false, 'Cyrillic, wrong key');
});

test('the code fallback keeps Shift, since case selects the command', () => {
  const S = loadSettings();
  // On Cyrillic, Shift+H gives 'Р'. Losing the case turns H, history back,
  // into h, scroll left.
  assert.equal(S.actionKey('Р', 'KeyH', true), 'H');
  assert.equal(S.actionKey('р', 'KeyH', false), 'h');
  assert.equal(S.actionKey('г', 'KeyG', true), 'G', 'G is bottom, g is a pending gg');
  assert.equal(S.actionKey('а', 'KeyF', true), 'F', 'F opens a background tab');
});

test('an action key falls back to the physical key on a non-Latin layout', () => {
  const S = loadSettings();

  // A Latin layout gives the character, so `w` means window whatever the
  // keycaps say and AZERTY users keep their mnemonics.
  assert.equal(S.actionKey('w', 'KeyW'), 'w');
  assert.equal(S.actionKey('a', 'KeyQ'), 'a', 'AZERTY keeps its label');
  assert.equal(S.actionKey('G', 'KeyG'), 'G', 'case is preserved for vim keys');
  assert.equal(S.actionKey('?', 'Slash'), '?');
  assert.equal(S.actionKey(',', 'Comma'), ',');
  assert.equal(S.actionKey('1', 'Digit1'), '1');

  // A non-Latin layout gives no usable character, so use the position.
  assert.equal(S.actionKey('ц', 'KeyW'), 'w', 'Cyrillic');
  assert.equal(S.actionKey('π', 'KeyP'), 'p', 'Greek');
  assert.equal(S.actionKey('Dead', 'KeyE'), 'e', 'a dead key still means something');
  assert.equal(S.actionKey('б', 'Comma'), ',');
});

test('capture uses the physical key, so macOS Option combos survive', () => {
  const S = loadSettings();
  // Option-A reports key 'å' and Option-E reports 'Dead'; code is stable.
  // 'å' is not a plain ASCII character, so only the position is remembered.
  assert.deepEqual(
    S.fromEvent({ ...press({ altKey: true }), key: 'å' }),
    { ctrl: false, alt: true, shift: false, meta: false, code: 'KeyA' }
  );
  // A plain character is remembered too, so the binding survives a layout change.
  assert.deepEqual(
    S.fromEvent({ ...press({ ctrlKey: true }), key: 'a' }),
    { ctrl: true, alt: false, shift: false, meta: false, code: 'KeyA', key: 'a' }
  );
  assert.equal(S.fromEvent(press({ code: 'ControlLeft', ctrlKey: true })), null);
  assert.equal(S.fromEvent(press()), null, 'a bare key is not a prefix');
});

test('host patterns are normalised to what location.hostname will be', () => {
  const S = loadSettings();
  assert.equal(S.normaliseHost('https://mail.google.com/inbox'), 'mail.google.com');
  assert.equal(S.normaliseHost('mail.google.com:443'), 'mail.google.com');
  assert.equal(S.normaliseHost('  FIGMA.com.  '), 'figma.com');
  assert.equal(S.normaliseHost('*.Figma.com'), '*.figma.com');
  assert.equal(S.normaliseHost('münchen.de'), 'xn--mnchen-3ya.de', 'IDNs are punycoded');
  assert.equal(S.normaliseHost(''), '');
  assert.equal(S.normaliseHost('   '), '');
});

test('disabled hosts match exactly, wildcards match the domain and below', () => {
  const S = loadSettings();
  const list = S.normalise({ disabled: ['mail.google.com', '*.figma.com', ' ', 'EXAMPLE.com'] }).disabled;

  assert.equal(S.disabledFor(list, 'mail.google.com'), true);
  assert.equal(S.disabledFor(list, 'example.com'), true);
  assert.equal(S.disabledFor(list, 'figma.com'), true, 'wildcard covers the bare domain');
  assert.equal(S.disabledFor(list, 'www.figma.com'), true);
  assert.equal(S.disabledFor(list, 'figma.com.'), true, 'a trailing dot must not bypass it');

  assert.equal(S.disabledFor(list, 'google.com'), false, 'an exact host must not match its parent');
  assert.equal(S.disabledFor(list, 'notfigma.com'), false);
  assert.equal(S.disabledFor(list, 'figma.com.evil.com'), false);
  assert.equal(S.disabledFor(list, ''), false);
});

test('a search template must be a web URL with a place for the query', () => {
  const S = loadSettings();
  assert.equal(S.normaliseSearch('https://duckduckgo.com/?q=%s'), 'https://duckduckgo.com/?q=%s');
  // Anything unusable falls back rather than sending the query nowhere.
  assert.equal(S.normaliseSearch('https://example.com/'), S.DEFAULT_SEARCH, 'no %s');
  assert.equal(S.normaliseSearch('javascript:alert(1)?q=%s'), S.DEFAULT_SEARCH, 'not a web URL');
  assert.equal(S.normaliseSearch('not a url %s'), S.DEFAULT_SEARCH);
  assert.equal(S.normaliseSearch(null), S.DEFAULT_SEARCH);

  assert.equal(
    S.searchUrl('https://kagi.com/search?q=%s', 'a b&c'),
    'https://kagi.com/search?q=a%20b%26c',
    'the query is escaped'
  );
  assert.equal(S.engineName('https://duckduckgo.com/?q=%s'), 'DuckDuckGo');
  assert.equal(S.engineName('https://my.intranet/find?q=%s'), 'my.intranet', 'custom shows its host');
});

test('every shipped engine preset is a usable template', () => {
  const S = loadSettings();
  for (const [name, url] of S.ENGINES) {
    assert.equal(S.normaliseSearch(url), url, `preset must survive: ${name}`);
  }
});

test('malformed stored settings cannot throw or grant a bad prefix', () => {
  const S = loadSettings();
  assert.deepEqual(
    S.normalise(null),
    { prefix: null, disabled: [], search: S.DEFAULT_SEARCH, keys: S.defaults().keys }
  );
  assert.deepEqual(S.normalise({ disabled: 'not-an-array' }).disabled, []);
  assert.equal(S.normalise({ prefix: { code: 'KeyA' } }).prefix, null, 'no modifier means no prefix');
  assert.equal(S.normalise({ prefix: {} }).prefix, null);
});

test('unusable host patterns are dropped, not saved to match nothing', () => {
  const S = loadSettings();
  for (const bad of ['*', '.com', 'http://', '*.', 'no spaces here', '..']) {
    assert.equal(S.normaliseHost(bad), '', `should be dropped: ${bad}`);
  }
  assert.equal(S.normaliseHost('localhost'), 'localhost', 'localhost is a real host');
  assert.equal(S.normaliseHost('localhost:3000'), 'localhost', 'a port is dropped');
  assert.equal(S.normaliseHost('127.0.0.1'), '127.0.0.1');
});

test('keys Chrome keeps for itself cannot be bound', () => {
  const S = loadSettings();
  const combo = (over) => ({ ctrl: false, alt: false, shift: false, meta: false, code: 'KeyA', ...over });

  assert.equal(S.isReserved(combo({ ctrl: true, code: 'KeyW' })), true, 'Ctrl-W closes the tab');
  assert.equal(S.isReserved(combo({ meta: true, code: 'KeyT' })), true);
  assert.equal(S.isReserved(combo({ ctrl: true, code: 'KeyA' })), false);
  assert.equal(S.isReserved(combo({ alt: true, code: 'KeyW' })), false, 'Alt-W is ours to take');
});

test('sync answering "nothing stored" is authoritative over a stale mirror', async () => {
  const stale = { get: async () => ({ settings: { disabled: ['deleted.com'] } }), set: async () => {} };
  const S = loadSettings({ sync: { get: async () => ({}), set: async () => {} }, local: stale });
  assert.deepEqual((await S.load()).disabled, S.defaults().disabled, 'the mirror must not win');
});

test('every default key binding is well formed', () => {
  const S = loadSettings();
  const seen = new Set();
  for (const [id, keys] of S.ACTIONS) {
    assert.ok(Array.isArray(keys) && keys.length, `${id} needs at least one default key`);
    for (const key of keys) {
      assert.match(key, /^[\x20-\x7e]$/, `${id}'s default key must be a plain ASCII character: ${key}`);
      assert.equal(S.FIXED_KEYS.has(key), false, `${id}'s default ${key} collides with a fixed key`);
      assert.equal(seen.has(key), false, `${key} is claimed by more than one action`);
      seen.add(key);
    }
  }
  const defaultKeys = S.defaults().keys;
  for (const [id] of S.ACTIONS) assert.ok(defaultKeys[id]?.length, `${id} missing from defaults().keys`);
});

test('normalise fills a missing action and drops unknown ids', () => {
  const S = loadSettings();
  const keys = S.normalise({ keys: { create: ['q'], bogus: ['z'] } }).keys;
  assert.deepEqual(keys.create, ['q'], 'an explicitly stored action is kept');
  assert.deepEqual(keys.close, ['x'], 'a missing action falls back to its default');
  assert.equal('bogus' in keys, false, 'an id outside the registry is dropped');
});

test('normalise drops unusable key candidates', () => {
  const S = loadSettings();
  const keys = S.normalise({ keys: { create: ['ñ', 'ab', ' ', '?', '5', 'q'] } }).keys;
  assert.deepEqual(keys.create, ['q'], 'only the one usable candidate survives');
});

test('a key claimed twice goes to the earlier action in registry order', () => {
  const S = loadSettings();
  const keys = S.normalise({ keys: { create: ['x'], close: ['x'] } }).keys;
  assert.deepEqual(keys.create, ['x'], 'create comes first in ACTIONS');
  assert.deepEqual(keys.close, [], 'close has no other default to fall back to, so it goes unbound');

  const withFallback = S.normalise({ keys: { switcher: ['b'], last: ['b'] } }).keys;
  assert.deepEqual(withFallback.switcher, ['b']);
  assert.deepEqual(withFallback.last, ['l'], 'last falls back to its other default, l, since b is taken');
});

test('a stored rebind survives a new action whose default is that key', () => {
  const S = loadSettings();
  // A 0.4.0 user who moved create to `a` must not lose it to audio on upgrade.
  const keys = S.normalise({ keys: { create: ['a'] } }).keys;
  assert.deepEqual(keys.create, ['a']);
  assert.deepEqual(keys.audio, [], 'audio comes earlier but only has a default, so it goes unbound');
});

test('uppercase defaults do not shadow their lowercase neighbours', () => {
  const S = loadSettings();
  const keys = S.defaults().keys;
  assert.equal(S.actionFor(keys, 'l'), 'last');
  assert.equal(S.actionFor(keys, 'L'), 'moveright');
  assert.equal(S.actionFor(keys, 'm'), 'call');
  assert.equal(S.actionFor(keys, 'M'), 'mute');
});

test('actionFor matches case exactly', () => {
  const S = loadSettings();
  const keys = S.defaults().keys;
  assert.equal(S.actionFor(keys, 'x'), 'close');
  assert.equal(S.actionFor(keys, 'X'), null, 'X is not bound to anything by default');
});

test('a malformed keys map cannot throw and falls back to defaults', () => {
  const S = loadSettings();
  for (const bad of ['garbage', ['a', 'b'], null, 42, undefined]) {
    assert.doesNotThrow(() => S.normalise({ keys: bad }));
    assert.deepEqual(S.normalise({ keys: bad }).keys, S.defaults().keys);
  }
});

test('keyProblem names the three ways a key can be unusable', () => {
  const S = loadSettings();
  const keys = S.defaults().keys;
  assert.equal(S.keyProblem(keys, 'create', 'ab'), 'invalid');
  assert.equal(S.keyProblem(keys, 'create', '?'), 'fixed');
  assert.equal(S.keyProblem(keys, 'create', 'x'), 'already used by close tab');
  assert.equal(S.keyProblem(keys, 'create', 'q'), null, 'a free key is fine');
});

test('a storage failure keeps the blocklist rather than assuming it is empty', async () => {
  const failing = { get: async () => { throw new Error('sync down'); }, set: async () => {} };
  const mirror = { get: async () => ({ settings: { disabled: ['figma.com'] } }), set: async () => {} };

  const withMirror = loadSettings({ sync: failing, local: mirror });
  assert.deepEqual((await withMirror.load()).disabled, ['figma.com'], 'falls back to the local mirror');

  const bothDown = loadSettings({
    sync: failing,
    local: { get: async () => { throw new Error('local down'); }, set: async () => {} }
  });
  assert.equal(await bothDown.load(), null, 'reports failure instead of an empty blocklist');
});
