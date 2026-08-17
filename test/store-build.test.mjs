import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

// There are two builds now: the one in this repo, and the narrower one that
// goes to the store without the New Tab Page. Two artifacts that drift is
// precisely how this project has broken before, so the difference is tested
// rather than trusted.

const root = fileURLToPath(new URL('..', import.meta.url));

function build() {
  const out = mkdtempSync(path.join(tmpdir(), 'tmuxium-store-'));
  execFileSync('node', [path.join(root, 'tools/build-store.cjs'), out], { stdio: 'pipe' });
  return out;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

test('the store build drops the new tab page and its permissions', () => {
  const out = build();
  try {
    const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));

    assert.equal(manifest.chrome_url_overrides, undefined);
    assert.ok(!manifest.permissions.includes('topSites'));
    assert.ok(!manifest.permissions.includes('favicon'));
    assert.ok(!existsSync(path.join(out, 'src/newtab.html')));
    assert.ok(!existsSync(path.join(out, 'src/newtab.js')));

    // What it must keep, or it is not the same extension.
    assert.deepEqual(manifest.permissions, ['tabs', 'storage', 'scripting']);
    assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
    assert.ok(existsSync(path.join(out, 'src/options.html')));
    assert.ok(existsSync(path.join(out, 'src/background.js')));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('the store build never references the page it dropped', () => {
  const out = build();
  try {
    for (const file of walk(out)) {
      if (!/\.(js|html|json)$/.test(file)) continue;
      const text = readFileSync(file, 'utf8');
      assert.ok(
        !text.includes('newtab') && !/\bnew tab page\b/i.test(text),
        `${path.relative(out, file)} still mentions the new tab page`
      );
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('every path the store manifest names exists in the store build', () => {
  const out = build();
  try {
    const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    const declared = [
      manifest.background.service_worker,
      manifest.options_ui.page,
      manifest.action.default_popup,
      ...manifest.content_scripts.flatMap((entry) => entry.js),
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon)
    ];

    for (const file of declared) {
      assert.ok(existsSync(path.join(out, file)), `store manifest names a missing file: ${file}`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('the store build ships no tests, tools or store artwork', () => {
  const out = build();
  try {
    for (const unwanted of ['test', 'tools', 'assets', 'node_modules', 'package.json']) {
      assert.ok(!existsSync(path.join(out, unwanted)), `${unwanted} should not ship`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
