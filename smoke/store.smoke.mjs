import { test as base, chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* The store build is a different artifact from the one in the repo, and it is
   the one strangers install. Checking its file list is not enough: it shipped a
   settings page that threw on its first line, because the build strips a
   section of markup and the script that touched it was left as it was. File
   lists and string greps all passed. So this loads the real thing. */

const root = fileURLToPath(new URL('..', import.meta.url));

const test = base.extend({
  store: async ({}, use) => {
    const out = mkdtempSync(path.join(tmpdir(), 'tmuxium-store-'));
    execFileSync('node', [path.join(root, 'tools/build-store.cjs'), out], { stdio: 'pipe' });
    const profile = mkdtempSync(path.join(tmpdir(), 'tmuxium-store-profile-'));

    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      args: [`--disable-extensions-except=${out}`, `--load-extension=${out}`]
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));

    await use({ context, id: new URL(worker.url()).host });

    await context.close();
    rmSync(profile, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('the store build has a settings page that actually works', async ({ store }) => {
  const page = await store.context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${store.id}/src/options.html`);

  // Nothing may throw, or every listener after the throw never attaches.
  expect(errors).toEqual([]);

  // The version stamp and the prefix label both come after the search section
  // in options.js, so they are the tell that the script ran to the end.
  await expect(page.locator('#version')).toHaveText(/^v\d+\.\d+\.\d+$/);
  await expect(page.locator('#prefix')).not.toHaveText('…');

  // The blocklist has to load and save, since it is the only escape hatch a
  // user has when the prefix clashes with a site.
  await expect(page.locator('#disabled')).toHaveValue(/mail\.google\.com/);
  await page.locator('#disabled').fill('example.org');
  await page.locator('#save').click();
  await expect(page.locator('#status')).toHaveText(/saved/);

  // And the search section really is gone, since that is the point.
  await expect(page.locator('#engine')).toHaveCount(0);
});

test('the store build serves no new tab page', async ({ store }) => {
  const page = await store.context.newPage();
  const response = await page.goto(`chrome-extension://${store.id}/src/newtab.html`).catch(() => null);
  expect(response?.ok() ?? false).toBe(false);
});

test('the store build still works as a prefix', async ({ store }) => {
  await store.context.serviceWorkers()[0].evaluate(() =>
    chrome.storage.sync.set({
      settings: {
        prefix: { ctrl: true, alt: false, shift: false, meta: false, code: 'KeyA', key: 'a' },
        disabled: []
      }
    })
  );

  const page = await store.context.newPage();
  await page.goto('https://example.com/');
  await page.locator('body').click();

  const worker = store.context.serviceWorkers()[0];
  const tabId = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.id ?? null;
  });

  await page.keyboard.press('Control+a');
  await expect
    .poll(() => worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId))
    .toBe('^A');
});
