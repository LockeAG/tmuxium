# Privacy policy

**Tmuxium has no server, and sends nothing to anyone.**

No analytics, no telemetry, no crash reporting, no account. The extension makes
no outbound network connection of any kind.

One thing does leave your machine, and it is worth being exact about: the
settings you type are saved in `chrome.storage.sync`, which Chrome carries to
your other signed-in machines the same way it carries your bookmarks. That is
Chrome doing it, not us, and it only happens if you have Chrome sync on.

## What it reads, and why

To be a tab switcher it has to see your tabs. Specifically:

| What | Why | Where it goes |
| --- | --- | --- |
| Tab titles and URLs | to list and filter your tabs, and to tell whether a tab is a video call | the list drawn on your screen, nothing else |
| Which tab is active, and which window | to switch to the right one and to offer "last tab" | in-memory session state |
| Whether a tab is playing audio | the dot that marks a live call | the list on your screen |
| Your most visited sites | the tiles on the replacement New Tab Page | that page, nothing else |
| Your settings: the prefix key and the list of sites to stay out of | to apply them | `chrome.storage.sync`, so Chrome carries them to your other signed-in machines |

None of it is sent to us, because there is nowhere to send it. There is no
server.

Two different stores are used, and the difference matters:

- **What it learns about your tabs** lives in `chrome.storage.session`, which
  Chrome clears when you quit. It is never written to disk.
- **The settings you type** live in `chrome.storage.sync`, with a copy in
  `chrome.storage.local` so a sync hiccup cannot lose your site list. Chrome
  syncs that through your Google account like your bookmarks, if you have sync
  turned on. So the hosts you add to the list travel the same way a bookmark
  does. If you would rather they did not, turn off extension sync in Chrome, or
  sign out.

## What it deliberately does not do

- It does not load your sites' favicons into the pages you visit. The tab list
  shows a colour derived from the hostname instead, so no request reveals your
  open tabs to the page you happen to be on.
- It never records or transmits anything from a page. It does read parts of one
  while you are using a feature that needs it: link hints read the `href` of the
  links on screen, find searches the page text for what you typed, and the
  `C-a C-a` passthrough reads the caret position in the field you are in so it
  can move it. None of that is stored, and none of it is sent anywhere.
- It does not read passwords, and it does not log what you type. Outside vim
  mode it waits for one key combination and, once armed, the single key after
  it. Vim mode, which is off until you turn it on, watches bare keys while it is
  active, and steps aside the moment a text box has focus.
- It contains no remote code and no `eval`. Every line is in the package you
  installed.
- It does not talk to other extensions or accept messages from web pages.

## Permissions

The Chrome Web Store build asks for fewer of these than the version in the
repository: it has no New Tab Page, so it needs neither `topSites` nor
`favicon`.

| Permission | What it is for |
| --- | --- |
| `tabs` | read tab titles and URLs, switch, create and close tabs |
| `storage` | session state for tabs, plus your settings (see above) |
| `scripting` | start working in tabs that were already open when you installed it |
| `topSites` | the tiles on the New Tab Page, repo build only |
| `favicon` | site icons on the New Tab Page, repo build only, never on your sites |
| `<all_urls>` | the prefix has to work on every page, so the key listener runs everywhere |

`<all_urls>` is the broadest of these. It is required because a keyboard
shortcut that only works on some sites is not a keyboard shortcut. It is used to
listen for keys, to draw the overlay, and to carry out what you asked for on the
page: scrolling, following a link hint, finding text, moving the caret. You can
switch it off per site in the settings, and the list ships with documents,
spreadsheets and mail already on it.

## Changes

Any change to this policy will appear in
[CHANGELOG.md](CHANGELOG.md) and in the repository history at
https://github.com/LockeAG/chrome-tmux.

Last updated: 2026-08-07.
