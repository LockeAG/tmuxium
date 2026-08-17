// @ts-check

(() => {
    const search = /** @type {HTMLInputElement} */ (document.getElementById('q'));

  const CONFIG = globalThis.SV_SETTINGS;
  let search_template = CONFIG.DEFAULT_SEARCH;

  // Name the prefix and the search engine the user actually has, not the
  // defaults somebody else picked.
  CONFIG.load().then((settings) => {
    const resolved = settings ?? CONFIG.defaults();
    search_template = resolved.search;
    /** @type {HTMLElement} */ (document.getElementById('prefix')).textContent =
      CONFIG.label(CONFIG.effectivePrefix(resolved));
    search.placeholder = `Search ${CONFIG.engineName(search_template)}`;
  });

  /** @type {HTMLFormElement} */ (document.getElementById('search')).addEventListener('submit', (event) => {
    event.preventDefault();
    const query = search.value.trim();
    if (query) location.href = CONFIG.searchUrl(search_template, query);
  });

  // Chrome parks focus in the omnibox when an extension overrides the New Tab
  // Page, and it does so around load rather than before it. A single focus()
  // call races that and loses, which is why Cmd-T used to leave you typing in
  // the address bar. So keep claiming focus for a short window instead.
  function claimFocus() {
    // Only take focus that nothing else wants. Without this the retry loop keeps
    // firing for the best part of a second after load and yanks focus out of the
    // tab tree if you hit Ctrl-A o straight after Cmd-T.
    const active = document.activeElement;
    if (active && active !== document.body && active !== search) return;
    window.focus();
    search.focus({ preventScroll: true });
  }

  function claimFocusUntil(ms) {
    const deadline = performance.now() + ms;
    (function again() {
      claimFocus();
      if (performance.now() < deadline) requestAnimationFrame(again);
    })();
  }

  claimFocusUntil(800);
  document.addEventListener('DOMContentLoaded', () => claimFocusUntil(400));
  window.addEventListener('load', () => claimFocusUntil(400));
  window.addEventListener('pageshow', () => claimFocusUntil(400));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) claimFocusUntil(200);
  });

  function faviconUrl(pageUrl) {
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', '32');
    return url.href;
  }

  chrome.topSites.get().then((sites) => {
    const nav = /** @type {HTMLElement} */ (document.getElementById('sites'));
    sites.slice(0, 12).forEach((site) => {
      const link = document.createElement('a');
      link.href = site.url;

      const icon = document.createElement('img');
      icon.src = faviconUrl(site.url);
      icon.alt = '';
      icon.onerror = () => icon.remove();

      const label = document.createElement('span');
      label.textContent = site.title || new URL(site.url).hostname;

      link.append(icon, label);
      nav.append(link);
    });
  }).catch((error) => {
    // A missing topSites permission should cost you the tiles, not the console.
    console.warn('[tmuxium] top sites unavailable:', error?.message ?? error);
  });

})();
