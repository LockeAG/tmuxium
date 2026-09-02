import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The content scripts are loaded from five places: the manifest, the on-demand
// injection in the service worker, and three HTML pages. Nothing in Chrome
// keeps those lists in step, and twice now a new file was added to one and
// forgotten in the others, leaving a page that threw on its first line and
// silently did nothing. These tests are the thing that notices.

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));

const CONTENT_SCRIPTS = manifest.content_scripts[0].js;

/** Every `<script src>` in an HTML file, resolved from the repo root. */
function scriptsIn(htmlPath) {
  const dir = path.posix.dirname(htmlPath);
  return [...read(htmlPath).matchAll(/<script\s+src="([^"]+)"/g)]
    .map((match) => path.posix.normalize(path.posix.join(dir, match[1])));
}

const HTML_PAGES = ['src/newtab.html', 'src/popup.html', 'src/options.html'];

test('every path the manifest names exists', () => {
  const declared = [
    manifest.background.service_worker,
    manifest.options_ui.page,
    manifest.action.default_popup,
    manifest.chrome_url_overrides.newtab,
    ...CONTENT_SCRIPTS,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon)
  ];

  for (const file of declared) {
    assert.ok(existsSync(path.join(root, file)), `manifest names a missing file: ${file}`);
  }
});

test('every script an HTML page loads exists', () => {
  for (const page of HTML_PAGES) {
    for (const script of scriptsIn(page)) {
      assert.ok(existsSync(path.join(root, script)), `${page} loads a missing file: ${script}`);
    }
  }
});

test('the service worker injects exactly what the manifest declares', () => {
  const source = read('src/background.js');
  const match = source.match(/executeScript\(\{[\s\S]*?files:\s*\[([\s\S]*?)\]/);
  assert.ok(match, 'could not find the injected file list in ensureContentScript');

  const injected = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    injected,
    CONTENT_SCRIPTS,
    'the on-demand injection and the manifest disagree, so tabs open before install get a different set'
  );
});

test('a page loading the content script loads its dependencies first, in order', () => {
  const main = CONTENT_SCRIPTS.at(-1);

  for (const page of HTML_PAGES) {
    const scripts = scriptsIn(page);
    if (!scripts.includes(main)) continue;

    const required = scripts.filter((script) => CONTENT_SCRIPTS.includes(script));
    assert.deepEqual(
      required,
      CONTENT_SCRIPTS,
      `${page} loads ${main} without the rest, or out of order, so it throws before any key works`
    );
  }
});

test('a page using the settings global loads settings.js', () => {
  const settings = CONTENT_SCRIPTS.find((file) => file.endsWith('settings.js'));
  assert.ok(settings, 'settings.js is no longer a content script, update this test');

  for (const page of HTML_PAGES) {
    const scripts = scriptsIn(page);
    const usesSettings = scripts
      .filter((script) => script.endsWith('.js') && existsSync(path.join(root, script)))
      .some((script) => read(script).includes('SV_SETTINGS'));

    if (!usesSettings) continue;
    assert.ok(
      scripts.includes(settings),
      `${page} reads SV_SETTINGS but never loads ${settings}`
    );
  }
});

test('every registered action is implemented, and the other way round', () => {
  // The prefix help used to be a static table matched against the worker's
  // raw-key cases. Both are generated from the action registry now, so the
  // coupling that matters moved: settings.js's ACTIONS against the ids
  // runPrefixAction actually switches on.
  const settings = read('src/content/settings.js');
  const background = read('src/background.js');

  const actions = settings.match(/const ACTIONS = \[([\s\S]*?)\n {2}\];/);
  assert.ok(actions, 'could not find ACTIONS in settings.js');
  const registered = new Set([...actions[1].matchAll(/\['(\w+)', \[/g)].map((m) => m[1]));
  assert.ok(registered.size, 'found no action ids in ACTIONS');

  const body = background.match(/async function runPrefixAction\([^)]*\) \{([\s\S]*?)\n\}/);
  assert.ok(body, 'could not find runPrefixAction in background.js');
  const implemented = new Set([...body[1].matchAll(/^\s{4}case '(\w+)':/gm)].map((m) => m[1]));

  // Digits are fixed, never in the registry: the worker handles them as their
  // own action rather than a case per key.
  const fixed = new Set(['jump']);

  for (const id of registered) {
    assert.ok(implemented.has(id), `ACTIONS lists ${id} but the worker has no case for it`);
  }
  for (const id of implemented) {
    if (fixed.has(id)) continue;
    assert.ok(registered.has(id), `the worker handles ${id} but it is not in ACTIONS`);
  }
});
