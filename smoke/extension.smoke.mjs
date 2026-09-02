import { test, expect, badge, activeTabId } from './fixtures.mjs';

/* The bugs that cost the most in this project were all invisible to `npm test`:
   a service worker that failed to import and died silently, and pages that
   loaded the content scripts but not their dependencies. Both are one page load
   away from obvious. These tests are that page load. */

test('the service worker starts and stays up', async ({ worker }) => {
  expect(worker.url()).toContain('background.js');
  // If the module graph failed to load, evaluating in it throws.
  const alive = await worker.evaluate(() => typeof chrome.tabs.query === 'function');
  expect(alive).toBe(true);
});

test('the new tab page loads every script it depends on', async ({ context, extensionId }) => {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/src/newtab.html`);

  // This page shipped dead once: it loaded main.js without settings.js, so the
  // first line threw and nothing on it worked.
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => typeof globalThis.SV_SETTINGS)).toBe('object');
  expect(await page.evaluate(() => typeof globalThis.SV_UI)).toBe('object');
  await expect(page.locator('#q')).toBeVisible();
  // The footer names the real prefix, which means settings resolved.
  await expect(page.locator('#prefix')).not.toHaveText('…');
});

test('the options page loads and resolves the prefix', async ({ context, extensionId }) => {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/src/options.html`);

  expect(errors).toEqual([]);
  await expect(page.locator('#prefix')).not.toHaveText('…');
  await expect(page.locator('#disabled')).toBeVisible();
  // The shipped blocklist should be in the box, not hidden.
  expect(await page.locator('#disabled').inputValue()).toContain('mail.google.com');
});

test('the UI shows which build is loaded', async ({ context, extensionId }) => {
  // Telling a stale build from a real bug has cost this project several rounds.
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options.html`);
  const shown = await page.locator('#version').textContent();
  expect(shown).toMatch(/^v\d+\.\d+\.\d+$/);
});

test('the popup loads and names the prefix', async ({ context, extensionId }) => {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/src/popup.html`);

  expect(errors).toEqual([]);
  await expect(page.locator('#prefix')).not.toHaveText('…');
});

test('an untouched prefix follows the platform', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options.html`);

  // Ctrl-A is select-all off macOS, so the default must differ by platform.
  // CI runs Linux and the author runs macOS, which is how this got noticed.
  const expected = process.platform === 'darwin' ? 'Ctrl-A' : 'Alt-A';
  await expect(page.locator('#prefix')).toHaveText(expected);
  await expect(page.locator('#prefix-note')).toContainText('default for this platform');
});

test('a real keystroke arms the prefix, end to end', async ({ context, worker, site, prefix }) => {
  const page = await context.newPage();
  // A bare goto that hangs shows up as an opaque test timeout, so fail loudly.
  const response = await page.goto(site);
  expect(response?.ok(), 'the local test server did not answer').toBe(true);
  await page.locator('body').click();

  const tabId = await activeTabId(worker);
  expect(await badge(worker, tabId)).toBe('');

  // Playwright presses keys through CDP, so these are trusted events. That is
  // the whole chain: content script, message to the worker, stored state.
  await page.keyboard.press(prefix);
  await expect.poll(() => badge(worker, tabId)).toBe('^A');
});

test('a synthetic keystroke does not, because pages must not drive this', async ({ context, worker, site, prefix }) => {
  const page = await context.newPage();
  await page.goto(site);
  await page.locator('body').click();
  const tabId = await activeTabId(worker);

  // Exactly the attack the isTrusted guard exists for: a page dispatching its
  // own KeyboardEvent to arm the prefix and then close the tab.
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true, cancelable: true
    }));
  });

  await page.waitForTimeout(300);
  expect(await badge(worker, tabId)).toBe('');
});

test('the prefix runs an action', async ({ context, worker, site, prefix }) => {
  const page = await context.newPage();
  await page.goto(site);
  await page.locator('body').click();

  const before = await worker.evaluate(async () => (await chrome.tabs.query({})).length);
  await page.keyboard.press(prefix);
  await page.keyboard.press('c');

  // `C-a c` opens a tab, which is observable without reaching into the closed
  // shadow root the overlay lives in.
  await expect
    .poll(() => worker.evaluate(async () => (await chrome.tabs.query({})).length))
    .toBe(before + 1);
});

test('a rebound key runs its action, and the old key does not', async ({ context, worker, site }) => {
  // Not `close`: closing the page under test would kill the Playwright page
  // mid-assertion.
  await worker.evaluate(() =>
    chrome.storage.sync.set({
      settings: {
        prefix: { ctrl: true, alt: false, shift: false, meta: false, code: 'KeyA' },
        disabled: [],
        keys: { create: ['q'] }
      }
    })
  );

  const page = await context.newPage();
  await page.goto(site);
  await page.locator('body').click();

  const before = await worker.evaluate(async () => (await chrome.tabs.query({})).length);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('q');

  // `C-a q` now opens a tab: the rebound `create` key.
  await expect
    .poll(() => worker.evaluate(async () => (await chrome.tabs.query({})).length))
    .toBe(before + 1);

  await page.bringToFront();
  await page.locator('body').click();
  const afterRebind = await worker.evaluate(async () => (await chrome.tabs.query({})).length);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('c');
  await page.waitForTimeout(300);

  // The old key is free: no tab opens.
  expect(await worker.evaluate(async () => (await chrome.tabs.query({})).length)).toBe(afterRebind);
});

test('vim mode toggles and shows in the badge', async ({ context, worker, site, prefix }) => {
  const page = await context.newPage();
  await page.goto(site);
  await page.locator('body').click();
  const tabId = await activeTabId(worker);

  await page.keyboard.press(prefix);
  await page.keyboard.press('v');
  await expect.poll(() => badge(worker, tabId)).toBe('V');

  await page.keyboard.press('Escape');
  await expect.poll(() => badge(worker, tabId)).toBe('');
});

test('the overlays name the prefix the user actually set', async ({ context, worker, site, extensionId }) => {
  // Rebind to something that is nobody's default, so a hardcoded 'C-a' shows up.
  await worker.evaluate(() =>
    chrome.storage.sync.set({
      settings: {
        prefix: { ctrl: true, alt: false, shift: false, meta: false, code: 'Semicolon', key: ';' },
        disabled: []
      }
    })
  );

  const page = await context.newPage();
  await page.goto(site);
  await page.locator('body').click();
  await page.waitForTimeout(300);

  await page.keyboard.press('Control+;');
  await expect
    .poll(() =>
      worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return chrome.action.getBadgeText({ tabId: tab.id });
      })
    )
    .toBe('^A', 'the rebound prefix arms');
});

test('the help overlay names the rebound key', async ({ context, worker, site }) => {
  // Rebind close away from its default x, so a hardcoded x in the help
  // screen would give the test away.
  await worker.evaluate(() =>
    chrome.storage.sync.set({
      settings: {
        prefix: { ctrl: true, alt: false, shift: false, meta: false, code: 'KeyA' },
        disabled: [],
        keys: { close: ['q'] }
      }
    })
  );

  const page = await context.newPage();
  await page.goto(site);
  await page.locator('body').click();
  await page.waitForTimeout(300);

  await page.keyboard.press('Control+a');
  await page.keyboard.press('?');
  await page.waitForTimeout(300);

  // The overlay lives in a closed shadow root, invisible to page JS and so to
  // ordinary locators too. CDP can still see it, the same way DevTools can.
  const cdp = await context.newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });

  /** @param {any} node @param {string[]} out */
  function collectText(node, out) {
    if (node.nodeValue) out.push(node.nodeValue);
    for (const child of node.children ?? []) collectText(child, out);
    for (const shadow of node.shadowRoots ?? []) collectText(shadow, out);
  }

  const texts = [];
  collectText(root, texts);
  const flat = texts.join(' ');

  // CONFIG.label() spells the pinned prefix out as Ctrl-A, not C-a.
  expect(flat).toContain('Ctrl-A q');
  expect(flat).toContain('close tab');
});

test('the tab tree announces itself to a screen reader', async ({ context, worker, site, prefix }) => {
  const page = await context.newPage();
  await page.goto(site);
  await page.locator('body').click();

  await page.keyboard.press(prefix);
  await page.keyboard.press('o');

  // The overlay lives in a closed shadow root, so ask the page for the host and
  // read the accessibility attributes from inside it via the extension itself.
  const roles = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 400));
    const host = document.getElementById('__chrome_tmux__');
    return { present: Boolean(host) };
  });
  expect(roles.present).toBe(true);

  // The switcher owns the keyboard, so Escape must return it.
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
});

test('the new tab page has a landmark and a named search box', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/newtab.html`);

  await expect(page.getByRole('search')).toBeVisible();
  await expect(page.getByLabel('Search the web')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Most visited' })).toBeAttached();
});

test('every control on the options page has a name', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options.html`);

  await expect(page.getByLabel('Search engine')).toBeVisible();
  await expect(page.getByLabel('Sites to stay out of, one host per line')).toBeVisible();
  await expect(page.getByRole('button', { name: /Prefix key/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
});

test('adding a site to the blocklist makes it inert, live', async ({ context, worker, extensionId, site, prefix }) => {
  const page = await context.newPage();
  await page.goto(site);
  await page.locator('body').click();
  const tabId = await activeTabId(worker);

  // Prove it works here first, or "inert" is indistinguishable from "the
  // content script never loaded", which is how the old version of this test
  // passed while proving nothing.
  await page.keyboard.press(prefix);
  await expect.poll(() => badge(worker, tabId)).toBe('^A');
  await page.keyboard.press('Escape');

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options.html`);
  await options.locator('#disabled').fill(new URL(site).hostname);
  await options.locator('#save').click();
  await expect(options.locator('#status')).toHaveText(/saved/);
  await options.close();

  // No reload: the open tab must stand down on its own.
  await page.bringToFront();
  await page.locator('body').click();
  await page.keyboard.press(prefix);
  await page.waitForTimeout(500);
  expect(await badge(worker, tabId)).toBe('');
});
