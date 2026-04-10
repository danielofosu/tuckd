// Tuckd — Command Bar (content script, injected into active tab)
// Uses Shadow DOM for CSS isolation from the host page.
// Standalone: command-bar-page.html (restricted URLs where injection is impossible)

(() => {
  const STANDALONE_PAGE =
    typeof location !== 'undefined' &&
    /command-bar-page\.html(\?|$)/.test(location.pathname);

  // Toggle if already injected (not used on standalone page — full reload each time)
  if (!STANDALONE_PAGE && window.__tuckdCommandBar) {
    window.__tuckdCommandBar.toggle();
    return;
  }

  // ─── State ──────────────────────────────────────────────────────────────────

  let selectedIndex = -1;
  let flatItems = [];        // flat list of rendered result items for keyboard nav
  let searchId = 0;          // track stale responses
  let debounceTimer = null;
  let savedOverflow = '';
  /** Restore { el, hadInert } after closing — `inert` keeps the page from receiving focus/keys */
  const inertRestore = [];

  // ─── Create Shadow DOM host ─────────────────────────────────────────────────

  const host = STANDALONE_PAGE
    ? document.getElementById('tuckd-host')
    : (() => {
        const el = document.createElement('div');
        el.id = 'tuckd-command-bar';
        return el;
      })();
  if (!host) return;
  const shadow = host.attachShadow({ mode: 'closed' });

  // Load styles from extension — track ready state to avoid FOUC
  let styleReady = false;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('src/command-bar/command-bar.css');
  link.onload = () => { styleReady = true; };
  shadow.appendChild(link);

  // ─── Build DOM ──────────────────────────────────────────────────────────────

  const overlay = document.createElement('div');
  overlay.className = 'tr-overlay';

  overlay.innerHTML = `
    <div class="tr-modal">
      <div class="tr-search-wrap">
        <svg class="tr-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input class="tr-search-input" type="text" placeholder="Search tabs, archive, bookmarks, history…" autocomplete="off" spellcheck="false" />
        <span class="tr-esc-hint">esc</span>
      </div>
      <div class="tr-results"></div>
      <div class="tr-footer">
        <span class="tr-footer-key"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span class="tr-footer-key"><kbd>↵</kbd> open</span>
        <span class="tr-footer-key"><kbd>esc</kbd> close</span>
      </div>
    </div>
  `;

  shadow.appendChild(overlay);

  const input = overlay.querySelector('.tr-search-input');
  const resultsContainer = overlay.querySelector('.tr-results');

  // ─── SVG helpers ────────────────────────────────────────────────────────────

  const GLOBE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

  const QUICK_ACTION_ICONS = {
    copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    archive: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
    play: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    grid: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
    target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  };

  // ─── Rendering ──────────────────────────────────────────────────────────────

  const SOURCE_LABELS = {
    openTabs: 'Open Tabs',
    archive: 'Archive',
    bookmarks: 'Bookmarks',
    history: 'History',
    workspaces: 'Workspaces',
  };

  const ACTION_LABELS = {
    openTabs: 'Switch',
    archive: 'Restore',
    bookmarks: 'Open',
    history: 'Open',
    workspaces: 'Restore',
  };

  function getHostname(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  }

  function renderResults(grouped) {
    resultsContainer.innerHTML = '';
    flatItems = [];
    selectedIndex = -1;

    const order = ['openTabs', 'workspaces', 'archive', 'bookmarks', 'history'];
    let hasAny = false;

    for (const source of order) {
      const items = grouped[source];
      if (!items || items.length === 0) continue;
      hasAny = true;

      const group = document.createElement('div');
      group.className = 'tr-group';

      const label = document.createElement('div');
      label.className = 'tr-group-label';
      label.textContent = SOURCE_LABELS[source];
      group.appendChild(label);

      for (const item of items) {
        const el = document.createElement('div');
        el.className = 'tr-item';
        el.dataset.index = flatItems.length;

        // Icon: workspace folder or favicon
        if (source === 'workspaces') {
          const iconWrap = document.createElement('div');
          iconWrap.className = 'tr-item-icon';
          iconWrap.innerHTML = QUICK_ACTION_ICONS.folder;
          el.appendChild(iconWrap);
        } else if (item.favIconUrl) {
          const img = document.createElement('img');
          img.className = 'tr-item-favicon';
          img.src = item.favIconUrl;
          img.alt = '';
          img.onerror = () => {
            const fallback = document.createElement('div');
            fallback.className = 'tr-item-favicon-fallback';
            fallback.innerHTML = GLOBE_SVG;
            img.replaceWith(fallback);
          };
          el.appendChild(img);
        } else {
          const fallback = document.createElement('div');
          fallback.className = 'tr-item-favicon-fallback';
          fallback.innerHTML = GLOBE_SVG;
          el.appendChild(fallback);
        }

        // Body (title + url + optional summary)
        const body = document.createElement('div');
        body.className = 'tr-item-body';
        const title = document.createElement('div');
        title.className = 'tr-item-title';
        title.textContent = item.title || 'Untitled';
        body.appendChild(title);

        if (source === 'workspaces') {
          const sub = document.createElement('div');
          sub.className = 'tr-item-url';
          sub.textContent = `${item.tabCount || 0} tabs`;
          body.appendChild(sub);
        } else {
          const url = document.createElement('div');
          url.className = 'tr-item-url';
          url.textContent = getHostname(item.url);
          body.appendChild(url);
        }

        // Description line
        const descText = item.description;
        if (descText && source !== 'workspaces') {
          const desc = document.createElement('div');
          desc.className = 'tr-item-summary';
          desc.textContent = descText;
          body.appendChild(desc);
        }

        el.appendChild(body);

        // Action badge
        const badge = document.createElement('span');
        badge.className = 'tr-item-badge';
        badge.textContent = ACTION_LABELS[item.source] || 'Open';
        el.appendChild(badge);

        // Click handler
        el.addEventListener('click', () => executeAction(item));

        group.appendChild(el);
        flatItems.push({ el, item });
      }

      resultsContainer.appendChild(group);
    }

    if (!hasAny) {
      resultsContainer.innerHTML = `
        <div class="tr-empty">
          <svg class="tr-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <span>No results found</span>
        </div>
      `;
    }
  }

  function renderQuickActions(actions) {
    resultsContainer.innerHTML = '';
    flatItems = [];
    selectedIndex = -1;

    if (actions.length === 0) {
      resultsContainer.innerHTML = `
        <div class="tr-empty">
          <span>No matching commands</span>
        </div>
      `;
      return;
    }

    const group = document.createElement('div');
    group.className = 'tr-group';

    const label = document.createElement('div');
    label.className = 'tr-group-label';
    label.textContent = 'Commands';
    group.appendChild(label);

    for (const action of actions) {
      const el = document.createElement('div');
      el.className = 'tr-item';
      el.dataset.index = flatItems.length;

      // Icon
      const iconWrap = document.createElement('div');
      iconWrap.className = 'tr-item-icon';
      iconWrap.innerHTML = QUICK_ACTION_ICONS[action.icon] || QUICK_ACTION_ICONS.settings;
      el.appendChild(iconWrap);

      // Body (name + description)
      const body = document.createElement('div');
      body.className = 'tr-item-body';
      const title = document.createElement('div');
      title.className = 'tr-item-title';
      title.textContent = action.name;
      const desc = document.createElement('div');
      desc.className = 'tr-item-url';
      desc.textContent = action.description;
      body.appendChild(title);
      body.appendChild(desc);
      el.appendChild(body);

      // Badge
      const badge = document.createElement('span');
      badge.className = 'tr-item-badge';
      badge.textContent = 'Run';
      el.appendChild(badge);

      const item = { source: 'quickAction', commandId: action.id, hasArg: action.hasArg, name: action.name };
      el.addEventListener('click', () => executeAction(item));

      group.appendChild(el);
      flatItems.push({ el, item });
    }

    resultsContainer.appendChild(group);
  }

  // ─── Keyboard navigation ────────────────────────────────────────────────────

  function setSelected(index) {
    if (flatItems.length === 0) return;

    // Remove old selection
    if (selectedIndex >= 0 && selectedIndex < flatItems.length) {
      flatItems[selectedIndex].el.classList.remove('tr-selected');
    }

    // Wrap
    if (index < 0) index = flatItems.length - 1;
    if (index >= flatItems.length) index = 0;

    selectedIndex = index;
    flatItems[selectedIndex].el.classList.add('tr-selected');
    flatItems[selectedIndex].el.scrollIntoView({ block: 'nearest' });
  }

  // ─── Search ─────────────────────────────────────────────────────────────────

  function doSearch() {
    const query = input.value;
    const thisSearchId = ++searchId;

    // Quick actions mode: > prefix
    if (query.startsWith('>')) {
      const subQuery = query.slice(1).trim();
      chrome.runtime.sendMessage({ action: 'commandBarQuickActions', query: subQuery }, (response) => {
        if (thisSearchId !== searchId) return;
        if (chrome.runtime.lastError) return;
        if (response) renderQuickActions(response);
      });
      return;
    }

    // Keyword search — instant (100ms debounce from input handler)
    chrome.runtime.sendMessage({ action: 'commandBarSearch', query }, (response) => {
      if (thisSearchId !== searchId) return;
      if (chrome.runtime.lastError) return;
      if (response) {
        renderResults(response);
      }
    });
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doSearch, 100);
  });

  // Block events from escaping shadow / reaching the document (capture + bubble on the input)
  function trapFromInput(e) {
    e.stopPropagation();
  }
  const trapTypes = [
    'keydown',
    'keyup',
    'keypress',
    'beforeinput',
    'input',
    'compositionstart',
    'compositionupdate',
    'compositionend',
  ];
  for (const type of trapTypes) {
    input.addEventListener(type, trapFromInput, true);
    input.addEventListener(type, trapFromInput, false);
  }
  overlay.addEventListener('mousedown', (e) => e.stopPropagation(), true);
  overlay.addEventListener('touchstart', (e) => e.stopPropagation(), true);

  /** Makes every body child except our host inert so editors/search on the page cannot stay focused. */
  function markBackgroundInert() {
    if (STANDALONE_PAGE || !document.body) return;
    for (const el of document.body.children) {
      if (el === host) continue;
      const hadInert = el.hasAttribute('inert');
      if (!hadInert) el.setAttribute('inert', '');
      inertRestore.push({ el, hadInert });
    }
  }

  function restoreBackgroundInert() {
    for (const { el, hadInert } of inertRestore) {
      if (!hadInert) el.removeAttribute('inert');
    }
    inertRestore.length = 0;
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  function executeAction(item) {
    if (item.source === 'quickAction') {
      // For commands with hasArg, parse arg from input after the command name
      let arg = '';
      if (item.hasArg) {
        const inputVal = input.value.slice(1).trim(); // remove >
        const nameLower = item.name.toLowerCase();
        const idx = inputVal.toLowerCase().indexOf(nameLower);
        if (idx >= 0) {
          arg = inputVal.slice(idx + nameLower.length).trim();
        } else {
          // Fallback: everything after the command ID
          const idIdx = inputVal.toLowerCase().indexOf(item.commandId);
          if (idIdx >= 0) {
            arg = inputVal.slice(idIdx + item.commandId.length).trim();
          }
        }
      }
      chrome.runtime.sendMessage({ action: 'commandBarQuickAction', commandId: item.commandId, arg });
      hide();
      return;
    }
    if (item.source === 'workspaces') {
      chrome.runtime.sendMessage({ action: 'commandBarAction', item });
      hide();
      return;
    }
    chrome.runtime.sendMessage({ action: 'commandBarAction', item });
    hide();
  }

  // ─── Keyboard handler ──────────────────────────────────────────────────────

  function blockKeysToPage(e) {
    if (!host.isConnected) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (path.includes(host)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    input.focus({ preventScroll: true });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hide();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setSelected(selectedIndex + 1);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setSelected(selectedIndex - 1);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (selectedIndex >= 0 && selectedIndex < flatItems.length) {
        executeAction(flatItems[selectedIndex].item);
      }
      return;
    }

    // Trap Tab inside the command bar
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // ─── Show / Hide ───────────────────────────────────────────────────────────

  function show() {
    if (!STANDALONE_PAGE) {
      document.body.appendChild(host);
      markBackgroundInert();
    }
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keydown', blockKeysToPage, true);

    // Wait for stylesheet before revealing — prevents flash of unstyled content
    const reveal = () => {
      requestAnimationFrame(() => {
        overlay.classList.add('tr-visible');
        input.focus({ preventScroll: true });
        requestAnimationFrame(() => input.focus({ preventScroll: true }));
      });
      doSearch();
    };

    if (styleReady) {
      reveal();
    } else {
      // First open — CSS still loading. Hide host until ready.
      host.style.visibility = 'hidden';
      const onReady = () => {
        host.style.visibility = '';
        reveal();
      };
      link.addEventListener('load', onReady, { once: true });
      // Safety timeout — don't leave invisible forever if load event somehow missed
      setTimeout(() => {
        if (!styleReady) {
          styleReady = true;
          host.style.visibility = '';
          reveal();
        }
      }, 200);
    }
  }

  function hide() {
    overlay.classList.remove('tr-visible');
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keydown', blockKeysToPage, true);
    document.body.style.overflow = savedOverflow;

    const teardown = () => {
      if (!STANDALONE_PAGE) restoreBackgroundInert();
      if (!STANDALONE_PAGE && host.parentNode) host.parentNode.removeChild(host);
      input.value = '';
      resultsContainer.innerHTML = '';
      flatItems = [];
      selectedIndex = -1;
      if (STANDALONE_PAGE) {
        try {
          window.close();
        } catch {
          /* ignore */
        }
      }
    };

    // Wait for fade-out animation
    setTimeout(teardown, 150);
  }

  function toggle() {
    if (host.parentNode) {
      hide();
    } else {
      show();
    }
  }

  // Click on backdrop dismisses
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hide();
  });

  // ─── Public API ─────────────────────────────────────────────────────────────

  window.__tuckdCommandBar = { toggle, show, hide };

  // Show immediately on first injection (or on standalone page load)
  show();
})();
