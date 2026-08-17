import { test as base, chromium, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EXTENSION = fileURLToPath(new URL('..', import.meta.url));

/**
 * Chrome only loads an extension into a persistent context, and only with a
 * real browser rather than the headless shell. Everything the unit tests cannot
 * see lives on the other side of this: the service worker actually starting,
 * the content script actually being injected, and a keystroke actually being
 * trusted.
 */
export const test = base.extend({
  /**
   * A real http origin to test on. Content scripts are not injected into
   * `data:` URLs, so a page served over http is the only honest surface, and a
   * local one keeps the suite offline and deterministic.
   */
  site: async ({}, use) => {
    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><title>smoke</title><body style="height:3000px">page</body>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    // 127.0.0.1 rather than localhost: on a CI runner localhost can resolve to
    // ::1 first, and a server bound to IPv4 only then hangs the navigation.
    await use(`http://127.0.0.1:${port}/`);
    // close() waits for open connections, and the browser holds a keep-alive
    // socket, so without this the teardown hangs until the test times out.
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  },

  context: async ({}, use) => {
    const profile = mkdtempSync(path.join(tmpdir(), 'tmuxium-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION}`,
        `--load-extension=${EXTENSION}`
      ]
    });
    await use(context);
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  },

  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },

  /**
   * Pin the prefix before any page opens. Left alone it follows the platform,
   * Ctrl-A on macOS and Alt-A elsewhere, so a test that hardcodes one passes on
   * the author's laptop and fails in CI. Setting it explicitly also checks that
   * a stored prefix is honoured over the default.
   */
  prefix: async ({ worker }, use) => {
    await worker.evaluate(() =>
      chrome.storage.sync.set({
        settings: {
          prefix: { ctrl: true, alt: false, shift: false, meta: false, code: 'KeyA' },
          disabled: []
        }
      })
    );
    await use('Control+a');
  }
});

export { expect };

/** The toolbar badge is the one piece of extension state a test can read. */
export async function badge(worker, tabId) {
  return worker.evaluate(
    (id) => chrome.action.getBadgeText(id === null ? {} : { tabId: id }),
    tabId ?? null
  );
}

/** The id Chrome gave the page under test, so badge state can be scoped to it. */
export async function activeTabId(worker) {
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.id ?? null;
  });
}
