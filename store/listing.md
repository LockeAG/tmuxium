# Chrome Web Store listing

Copy-paste material for the developer dashboard. Everything here describes the
**store build**, which is `pnpm build:store` output, not the repo root: it has no
New Tab Page, and therefore no `topSites` or `favicon` permission.

Submit the zip of `dist/`, not the repository.

---

## Product name

```
Tmuxium
```

## Summary

Store limit is 132 characters. This is 119.

```
Drive Chrome the way you drive tmux. A prefix key, a searchable tab tree across every window, and a vim mode for pages.
```

## Category

Workflow & Planning. Language: English.

---

## Detailed description

```
If you live in tmux, your hands already know this. Press Ctrl-A, then a letter.

Ctrl-A then Ctrl-O opens a searchable list of every tab in every window, grouped
by window. Type to filter, Ctrl-J and Ctrl-K to move, Enter to switch, Ctrl-X to
close a tab without leaving the list. Ctrl-A then 1-9 jumps by position, b
toggles back to the last tab you were on, and m jumps straight to whichever tab
is a live video call.

There is a vim mode too, for moving around inside a page: h j k l to scroll, gg
and G for the ends, f to label every link and type its label to follow it, /
to find. It stands aside the moment a text box has focus, so typing in a search
field never scrolls the page.

THE KEYS

Prefix, press Ctrl-A then:
  Ctrl-O, o, w   the tab tree, searchable across every window
  s              the same tree, one row per window
  b, l           toggle back to the last tab you were on
  p, n           previous, next tab
  1-9            jump to a tab by position
  m              jump to a video call
  c              new tab
  x              close this tab
  v              vim mode on or off
  ,              settings
  ?              every key, shown in the page
  Ctrl-A         jump the caret to the start of the line
  Esc            cancel, having pressed the prefix by mistake

Vim mode, bare keys:
  h j k l        scroll
  d u            half a page
  gg G           top, bottom
  f F            link hints, F opens in a background tab
  / n N          find, next, previous
  H L            back, forward
  r              reload
  Esc            leave vim mode

THE ONE ANNOYING TRADE

The prefix is taken on every page it runs on, inside text boxes too. On macOS
the default is Ctrl-A, so you lose "jump to the start of the line". Press the
prefix twice to get it back, exactly like send-prefix in tmux.

On Windows and Linux the default is Alt-A instead, because Ctrl-A is select-all
there. Either way the prefix is rebindable in settings, and you can switch the
extension off entirely on any site. Documents, spreadsheets and mail are on that
list already, since their own editing keys matter more. Open settings to see the
full list or change it.

PRIVACY

It makes no network requests. There is no server, no analytics, no telemetry, no
account. It reads your tab titles and URLs because that is what a tab switcher
does, and they never leave your browser. Nothing is collected and nothing is
transmitted.

The tab list deliberately shows a colour derived from each hostname instead of
the site's real favicon, because loading favicons would put one request per open
tab into the page you are currently on, letting that page work out what you have
open.

WHAT IT CANNOT DO

Chrome forbids every extension from running on chrome:// pages, the Web Store
and the PDF viewer, so the keys are dead there and no extension can change that.
Keys typed in the address bar belong to Chrome, not to the page.

Link hints skip anything inside an iframe. There are no counts like 3j and no
marks yet.

Open source, MIT licensed: https://github.com/LockeAG/tmuxium
```

---

## Privacy practices

### Single purpose

```
Tmuxium provides keyboard-driven navigation of Chrome's tabs and windows
using a tmux-style prefix key, plus vim-style keys for scrolling and following
links within a page. Every feature serves that one purpose: switching between,
opening, closing and moving around tabs and pages using the keyboard.
```

### Permission: `tabs`

```
Needed to read tab titles and URLs so the tab switcher can list and filter them,
and to recognise when a tab is a video call. Also used to activate, create and
close tabs in response to the keyboard shortcuts the user presses. Titles and
URLs are only ever shown back to the user in the overlay; nothing is stored
beyond the browser session and nothing is transmitted.
```

### Permission: `storage`

```
Stores the user's own settings: which prefix key they chose, and the list of
sites where they want the extension to stay out of the way. Also holds per-tab
state for the current session, such as whether vim mode is on, in
chrome.storage.session, which Chrome clears on quit.
```

### Permission: `scripting`

```
Used once, on install and update, to inject the extension's own content script
into tabs that were already open. Without it those tabs would not respond to the
keyboard shortcut until the user reloaded every one of them by hand. Only the
extension's own bundled script files are injected; no code is generated, fetched
or evaluated at runtime.
```

### Host permission: `<all_urls>`

```
The extension is a keyboard shortcut, and a shortcut that only works on some
sites is not a shortcut. The content script listens for one key combination and
draws its overlay in a closed shadow root.

It reads part of the page only while carrying out something the user asked for:
link hints read the href of the links on screen, find searches the page text for
what was typed, and the double-prefix passthrough reads the caret position in
the focused field so it can move it. None of that is stored, logged or
transmitted. It does not read passwords and does not record what the user
types.

Users can switch it off per site in settings, and it ships already switched off
for mail, document, spreadsheet and design editors (Gmail and Google Docs among
them), where the page's own editing keys matter more.
```

### Remote code

**No.** Every line executed is in the uploaded package. No `eval`, no `new
Function`, no remotely hosted scripts, no CDN.

### Data usage

Tick **nothing**, then certify all three statements.

The form asks what the extension *collects or transmits*. This one does neither:
it makes no network requests at all. Reading a tab title to draw it in a list on
the user's own screen is not collection.

If a reviewer queries the `tabs` permission against an empty data declaration,
the answer is: the data never leaves the device, is held in
`chrome.storage.session` and cleared on quit, and the extension has no server to
send it to.

### Privacy policy URL

```
https://github.com/LockeAG/tmuxium/blob/main/PRIVACY.md
```

---

## Before you submit

- [ ] `pnpm build:store`, then zip the **contents** of `dist/`, not the folder
- [ ] Load that zip unpacked once and press the keys. It is a different build
      from the one you have been using: no New Tab Page, and `tabs`, `storage`
      and `scripting` where the repo build also has `topSites` and `favicon`
- [ ] Check `manifest.json` in the zip says `Tmuxium` and lists exactly
      `tabs`, `storage`, `scripting`
- [ ] Version: the package still says `0.2.3`. The Web Store rejects an upload
      whose version is not higher than the last one it accepted, so if `0.2.3`
      was already uploaded on the rejected revision, bump before zipping
- [ ] Screenshots: `assets/store/screenshot-01.png`, `-02.png`, `-03.png`, 1280x800.
      Regenerate with `node tools/make-screenshots.mjs` after any UI change
- [ ] Small promo tile: `assets/store/promo-small.png`, 440x280
- [ ] Marquee: `assets/store/promo-marquee.png`, 1400x560
- [ ] Store icon: `assets/store/store-icon-128.png`

Expect a slow review. `tabs` plus a content script on every site puts this in
the in-depth queue whatever the listing says. That is a schedule fact, not
something the copy can fix.
