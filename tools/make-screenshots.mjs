// Store screenshots, taken from the build that actually gets submitted.
//
// Two things this fixes over grabbing them by hand. It renders at twice the
// pixel density and writes PNG, so the text is sharp rather than JPEG mush.
// And it runs in a throwaway profile with tabs it opens itself, so nobody's
// real browsing ends up in a public listing.
//
// Run: node tools/make-screenshots.mjs [outDir]

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(root, 'assets/store'));

const SIZE = { width: 1280, height: 800 };
const SCALE = 2;

// Recognisable, uncontroversial, and nothing to do with whoever runs this.
const TABS = [
  'https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent',
  'https://en.wikipedia.org/wiki/Tmux',
  'https://news.ycombinator.com/',
  'https://github.com/LockeAG/chrome-tmux'
];

const store = mkdtempSync(path.join(tmpdir(), 'tmuxium-shots-build-'));
execFileSync('node', [path.join(root, 'tools/build-store.cjs'), store], { stdio: 'pipe' });

const profile = mkdtempSync(path.join(tmpdir(), 'tmuxium-shots-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  viewport: SIZE,
  deviceScaleFactor: SCALE,
  // The extension is Tokyo Night. A light-mode settings page next to two dark
  // overlays looks like two different products.
  colorScheme: 'dark',
  args: [`--disable-extensions-except=${store}`, `--load-extension=${store}`]
});

const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
const extensionId = new URL(worker.url()).host;

// Nothing is written to storage on purpose: the shots should show what someone
// sees on a fresh install, including the shipped blocklist. Run this on macOS,
// where the default prefix is Ctrl-A.

mkdirSync(out, { recursive: true });

// The profile opens with a blank tab, and it would show up in the tab tree.
for (const blank of context.pages()) {
  if (blank.url() === 'about:blank') await blank.close();
}

/** Downscale the 2x capture to the store's exact size, which is where the sharpness comes from. */
function finish(file) {
  execFileSync('/usr/bin/sips', ['-z', String(SIZE.height), String(SIZE.width), file], { stdio: 'pipe' });
  console.log(`${path.basename(file)} ${SIZE.width}x${SIZE.height}`);
}

for (const url of TABS) {
  const tab = await context.newPage();
  await tab.setViewportSize(SIZE);
  await tab.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
}

const page = context.pages().at(-1);
await page.bringToFront();
await page.locator('body').click({ position: { x: 400, y: 500 } }).catch(() => {});
await page.waitForTimeout(600);

// 1. The tab tree, the reason the extension exists.
await page.keyboard.press('Control+a');
await page.keyboard.press('o');
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(out, 'screenshot-01.png') });
finish(path.join(out, 'screenshot-01.png'));
await page.keyboard.press('Escape');

// 2. Every key, which is the fastest way to understand what this is.
await page.waitForTimeout(300);
await page.keyboard.press('Control+a');
await page.keyboard.press('?');
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(out, 'screenshot-02.png') });
finish(path.join(out, 'screenshot-02.png'));

// 3. The settings, which answer the question a reviewer will have about a
//    keyboard shortcut that runs everywhere.
const options = await context.newPage();
await options.setViewportSize(SIZE);
await options.goto(`chrome-extension://${extensionId}/src/options.html`);
await options.waitForTimeout(500);
await options.screenshot({ path: path.join(out, 'screenshot-03.png') });
finish(path.join(out, 'screenshot-03.png'));

await context.close();
rmSync(profile, { recursive: true, force: true });
rmSync(store, { recursive: true, force: true });
console.log(`\nwritten to ${path.relative(process.cwd(), out) || out}`);
