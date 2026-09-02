// @ts-check

(() => {
  const CONFIG = globalThis.SV_SETTINGS;

  /** @type {HTMLElement} */ (document.getElementById('version')).textContent =
    `v${chrome.runtime.getManifest().version}`;

  /** @type {HTMLElement} */ (document.getElementById('options')).addEventListener('click', (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });

  const prefixActions = document.getElementById('prefix-actions');

  /** Every action is rebindable, so the table is built from what is actually
   *  stored rather than baked into the markup.
   * @param {Record<ActionId, string[]>} keys
   */
  function renderPrefixActions(keys) {
    if (!prefixActions) return;
    for (const [id, , description] of CONFIG.ACTIONS) {
      const bound = keys[id] ?? [];
      const row = document.createElement('tr');
      const keyCell = document.createElement('td');
      keyCell.textContent = bound.length ? `C-a ${bound.join(' / ')}` : 'C-a (unbound)';
      const descCell = document.createElement('td');
      descCell.textContent = description;
      row.append(keyCell, descCell);
      prefixActions.append(row);
    }
  }

  // The prefix is per-platform and rebindable, so show what is actually set.
  CONFIG.load().then((settings) => {
    const resolved = settings ?? CONFIG.defaults();
    /** @type {HTMLElement} */ (document.getElementById('prefix')).textContent =
      CONFIG.label(CONFIG.effectivePrefix(resolved));
    renderPrefixActions(resolved.keys);
  });
})();
