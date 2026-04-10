// Tuckd — Archive page

if (!chrome.runtime?.id) location.reload();

let allItems = [];

// ─── Time helpers ──────────────────────────────────────────────────────────────

function getDateGroup(ts) {
  const now = new Date();
  const d = new Date(ts);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today - 86400000);
  const thisWeekStart = new Date(today - today.getDay() * 86400000);

  const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (itemDay >= today) return 'Today';
  if (itemDay >= yesterday) return 'Yesterday';
  if (itemDay >= thisWeekStart) return 'This Week';

  const diff = today - itemDay;
  const weeks = Math.floor(diff / (7 * 86400000));
  if (weeks < 4) return `${weeks} Week${weeks === 1 ? '' : 's'} Ago`;
  const months = Math.floor(diff / (30 * 86400000));
  if (months < 12) return `${months} Month${months === 1 ? '' : 's'} Ago`;
  return 'Older';
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── DOM helpers ───────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  return escapeHtml(text).replace(re, '<span class="highlight">$1</span>');
}

function buildFavicon(item) {
  if (item.favIconUrl && item.favIconUrl.startsWith('http')) {
    return `<img class="tab-favicon" src="${escapeHtml(item.favIconUrl)}" alt=""
      onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
      <span class="tab-favicon-fallback" style="display:none">
        <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10z" clip-rule="evenodd"/></svg>
      </span>`;
  }
  return `<span class="tab-favicon-fallback">
    <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.083 9h1.946c.089-1.546.383-2.97.837-4.118A6.004 6.004 0 004.083 9zM10 2a8 8 0 100 16A8 8 0 0010 2zm0 2c-.076 0-.232.032-.465.262-.238.234-.497.623-.737 1.182-.389.907-.673 2.142-.766 3.556h3.936c-.093-1.414-.377-2.649-.766-3.556-.24-.559-.499-.948-.737-1.182C10.232 4.032 10.076 4 10 4zm3.971 5c-.089-1.546-.383-2.97-.837-4.118A6.004 6.004 0 0115.917 9h-1.946zm-2.003 2H8.032c.093 1.414.377 2.649.766 3.556.24.559.499.948.737 1.182.233.23.389.262.465.262.076 0 .232-.032.465-.262.238-.234.498-.623.737-1.182.389-.907.673-2.142.766-3.556zm1.166 4.118c.454-1.147.748-2.572.837-4.118h1.946a6.004 6.004 0 01-2.783 4.118zm-6.268 0C6.412 13.97 6.118 12.546 6.03 11H4.083a6.004 6.004 0 002.783 4.118z" clip-rule="evenodd"/></svg>
  </span>`;
}

function buildTabItem(item, index, query = '') {
  const title = item.title || item.url;
  const url = item.url;
  let displayUrl;
  try {
    displayUrl = new URL(url).hostname;
  } catch {
    displayUrl = url;
  }

  const div = document.createElement('div');
  div.className = 'tab-item';
  div.dataset.index = index;
  div.innerHTML = `
    ${buildFavicon(item)}
    <div class="tab-body">
      <div class="tab-title">${highlightMatch(title, query)}</div>
      <div class="tab-url">${highlightMatch(displayUrl, query)}</div>
      ${item.description ? `<div class="tab-desc">${highlightMatch(item.description, query)}</div>` : ''}
    </div>
    <div class="tab-meta">${formatTime(item.archivedAt)}</div>
    <div class="tab-actions">
      <button class="icon-btn restore" title="Restore tab" data-index="${index}">
        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/></svg>
      </button>
      <button class="icon-btn delete" title="Delete" data-index="${index}">
        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
      </button>
    </div>
  `;

  // Clicking the title/url area opens the tab
  div.querySelector('.tab-body').addEventListener('click', () => restoreTab(item.url, item.archivedAt));
  div.querySelector('.tab-title').style.cursor = 'pointer';

  div.querySelector('.restore').addEventListener('click', (e) => {
    e.stopPropagation();
    restoreTab(item.url, item.archivedAt);
  });

  div.querySelector('.delete').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTab(item.url, item.archivedAt);
  });

  return div;
}

// ─── Render ────────────────────────────────────────────────────────────────────

// Cache at module scope — must not be inside a function that runs after innerHTML clears
const emptyEl = document.getElementById('emptyState');

function renderList(items, query = '') {
  const list = document.getElementById('archiveList');

  list.innerHTML = '';

  if (items.length === 0) {
    emptyEl.style.display = '';
    return;
  }

  emptyEl.style.display = 'none';

  // Group by date
  const groups = new Map();
  items.forEach((item) => {
    const group = getDateGroup(item.archivedAt);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ item, originalIndex: allItems.indexOf(item) });
  });

  for (const [groupName, entries] of groups) {
    const groupEl = document.createElement('div');
    groupEl.className = 'date-group';

    const label = document.createElement('div');
    label.className = 'date-label';
    label.textContent = groupName;
    groupEl.appendChild(label);

    for (const { item, originalIndex } of entries) {
      groupEl.appendChild(buildTabItem(item, originalIndex, query));
    }

    list.appendChild(groupEl);
  }
}

function updateHeader(count) {
  document.getElementById('tabCount').textContent =
    count === 0 ? 'No archived tabs' : `${count} archived tab${count === 1 ? '' : 's'}`;
}

// ─── Actions ───────────────────────────────────────────────────────────────────

async function restoreTab(url, archivedAt) {
  const item = allItems.find((a) => a.url === url && a.archivedAt === archivedAt);
  if (!item) return;
  try {
    await chrome.tabs.create({ url: item.url, active: true });
    await deleteTab(url, archivedAt);
  } catch {
    // Tab creation failed — don't remove from archive
  }
}

async function deleteTab(url, archivedAt) {
  allItems = allItems.filter((a) => !(a.url === url && a.archivedAt === archivedAt));
  await chrome.storage.local.set({ archive: allItems });
  const query = document.getElementById('searchInput').value.trim().toLowerCase();
  const filtered = query ? allItems.filter((i) => matchesQuery(i, query)) : allItems;
  renderList(filtered, query);
  updateHeader(allItems.length);
}

function matchesQuery(item, query) {
  return (
    item.title?.toLowerCase().includes(query) ||
    item.url?.toLowerCase().includes(query) ||
    item.description?.toLowerCase().includes(query)
  );
}

// ─── Load + wire ───────────────────────────────────────────────────────────────

async function init() {
  const { archive = [] } = await chrome.storage.local.get('archive');
  allItems = [...archive];
  updateHeader(allItems.length);
  renderList(allItems);

  // Search
  let searchTimer;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = e.target.value.trim().toLowerCase();
      const filtered = q ? allItems.filter((i) => matchesQuery(i, q)) : allItems;
      renderList(filtered, q);
    }, 150);
  });

  // Clear all
  document.getElementById('btnClearAll').addEventListener('click', async () => {
    if (!confirm(`Clear all ${allItems.length} archived tab${allItems.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    allItems = [];
    await chrome.storage.local.set({ archive: [] });
    renderList([]);
    updateHeader(0);
  });

  // Settings
  document.getElementById('btnSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

init();
