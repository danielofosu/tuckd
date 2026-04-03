// Tidytabs — background service worker
// Runs cleanup checks every 15 minutes via chrome.alarms

const DEFAULTS = {
  enabled: true,
  archiveAfterHours: 12,
  protectPinned: true,
  protectAudible: true,
  protectGrouped: true,
  clearArchiveAfterDays: 30,
};

const ARCHIVE_MAX = 2000;
const FRECENCY_MAX = 500;
const CLEANUP_ALARM = 'cleanup';
const CLEAR_OLD_ALARM = 'clearOldArchive';
const BADGE_CLEAR_ALARM = 'badgeClear';

// Register listeners at top level so they survive SW restarts
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === CLEANUP_ALARM) await runCleanup();
  if (alarm.name === CLEAR_OLD_ALARM) await clearOldArchive();
  if (alarm.name === BADGE_CLEAR_ALARM) chrome.action.setBadgeText({ text: '' });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'runNow') {
    runCleanup().then((result) => sendResponse(result));
    return true;
  }
  if (msg.action === 'getStats') {
    getStats().then((stats) => sendResponse(stats));
    return true;
  }
  if (msg.action === 'getNextAlarm') {
    chrome.alarms.get(CLEANUP_ALARM).then((alarm) => {
      sendResponse({ scheduledTime: alarm ? alarm.scheduledTime : null });
    });
    return true;
  }
  if (msg.action === 'commandBarSearch') {
    commandBarSearch(msg.query).then((results) => sendResponse(results));
    return true;
  }
  if (msg.action === 'commandBarAction') {
    commandBarAction(msg.item).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === 'commandBarQuickActions') {
    sendResponse(filterQuickActions(msg.query));
    return false;
  }
  if (msg.action === 'commandBarQuickAction') {
    executeQuickAction(msg.commandId, msg.arg).then((result) => sendResponse(result));
    return true;
  }
});

// ─── Command bar ──────────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-command-bar') return;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) return;

  // Fallback: chrome:// pages can't run content scripts
  const url = activeTab.url || '';
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
    chrome.tabs.create({ url: chrome.runtime.getURL('archive.html') });
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ['command-bar.js'],
    });
  } catch {
    // Content script injection failed — open archive as fallback
    chrome.tabs.create({ url: chrome.runtime.getURL('archive.html') });
  }
});

// ─── Quick actions ───────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { id: 'close-duplicates', name: 'Close Duplicates', description: 'Close tabs with duplicate URLs', icon: 'copy' },
  { id: 'archive-all', name: 'Archive All', description: 'Run cleanup immediately', icon: 'archive' },
  { id: 'pause', name: 'Pause', description: 'Disable auto-archiving', icon: 'pause' },
  { id: 'resume', name: 'Resume', description: 'Re-enable auto-archiving', icon: 'play' },
  { id: 'group-by-domain', name: 'Group by Domain', description: 'Auto-group tabs by hostname', icon: 'grid' },
  { id: 'focus', name: 'Focus Mode', description: 'Archive everything except current tab', icon: 'target' },
  { id: 'settings', name: 'Settings', description: 'Open settings page', icon: 'settings' },
  { id: 'archive', name: 'View Archive', description: 'Open archive page', icon: 'folder' },
  { id: 'save-workspace', name: 'Save Workspace', description: 'Save current tabs as named workspace', icon: 'folder', hasArg: true },
  { id: 'workspaces', name: 'Workspaces', description: 'List saved workspaces', icon: 'folder' },
  { id: 'restore-workspace', name: 'Restore Workspace', description: 'Restore a saved workspace', icon: 'folder', hasArg: true },
];

function filterQuickActions(query) {
  if (!query) return QUICK_ACTIONS;
  const q = query.toLowerCase();
  return QUICK_ACTIONS.filter(
    (a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.id.includes(q)
  );
}

async function executeQuickAction(commandId, arg) {
  switch (commandId) {
    case 'close-duplicates': {
      const tabs = await chrome.tabs.query({});
      const seen = new Map();
      const toClose = [];
      for (const tab of tabs) {
        const key = normalizeUrl(tab.url || '');
        if (seen.has(key)) {
          toClose.push(tab.id);
        } else {
          seen.set(key, tab.id);
        }
      }
      for (const id of toClose) {
        try { await chrome.tabs.remove(id); } catch { /* already closed */ }
      }
      return { closed: toClose.length };
    }
    case 'archive-all': {
      return await runCleanup();
    }
    case 'pause': {
      const { settings = {} } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...DEFAULTS, ...settings, enabled: false } });
      return { paused: true };
    }
    case 'resume': {
      const { settings = {} } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...DEFAULTS, ...settings, enabled: true } });
      return { resumed: true };
    }
    case 'group-by-domain': {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const byDomain = new Map();
      for (const tab of tabs) {
        try {
          const host = new URL(tab.url).hostname.replace(/^www\./, '');
          if (!byDomain.has(host)) byDomain.set(host, []);
          byDomain.get(host).push(tab.id);
        } catch { /* skip invalid URLs */ }
      }
      for (const [domain, tabIds] of byDomain) {
        if (tabIds.length < 2) continue;
        const groupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(groupId, { title: domain });
      }
      return { grouped: byDomain.size };
    }
    case 'focus': {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!active) return { focused: false };
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      const toArchive = [];
      const toClose = [];
      const now = Date.now();
      for (const tab of allTabs) {
        if (tab.id === active.id) continue;
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
        toArchive.push({
          url: tab.url,
          title: tab.title || tab.url,
          favIconUrl: tab.favIconUrl || '',
          archivedAt: now,
          idleMs: 0,
        });
        toClose.push(tab.id);
      }
      if (toArchive.length > 0) {
        const { archive = [] } = await chrome.storage.local.get('archive');
        await chrome.storage.local.set({ archive: [...toArchive, ...archive].slice(0, ARCHIVE_MAX) });
        for (const id of toClose) {
          try { await chrome.tabs.remove(id); } catch { /* already closed */ }
        }
      }
      return { archived: toArchive.length };
    }
    case 'settings': {
      await chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
      return { opened: true };
    }
    case 'archive': {
      await chrome.tabs.create({ url: chrome.runtime.getURL('archive.html') });
      return { opened: true };
    }
    case 'save-workspace': {
      return await saveWorkspace(arg || `Workspace ${new Date().toLocaleDateString()}`);
    }
    case 'workspaces': {
      return await listWorkspaces();
    }
    case 'restore-workspace': {
      return await restoreWorkspace(arg);
    }
    default:
      return { error: 'Unknown command' };
  }
}

// ─── Workspaces ──────────────────────────────────────────────────────────────

const WORKSPACE_MAX = 20;

async function saveWorkspace(name) {
  if (!name) return { error: 'Name required' };
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const workspace = {
    name,
    tabs: tabs
      .filter((t) => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'))
      .map((t) => ({ url: t.url, title: t.title || t.url, favIconUrl: t.favIconUrl || '' })),
    createdAt: Date.now(),
    lastUsed: Date.now(),
  };
  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  const filtered = workspaces.filter((w) => w.name !== name);
  const updated = [workspace, ...filtered].slice(0, WORKSPACE_MAX);
  await chrome.storage.local.set({ workspaces: updated });
  return { saved: workspace.tabs.length };
}

async function listWorkspaces() {
  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  return workspaces;
}

async function restoreWorkspace(name) {
  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  const ws = workspaces.find((w) => w.name === name);
  if (!ws) return { error: 'Workspace not found' };
  for (const tab of ws.tabs) {
    await chrome.tabs.create({ url: tab.url });
  }
  ws.lastUsed = Date.now();
  await chrome.storage.local.set({ workspaces });
  return { restored: ws.tabs.length };
}

// ─── Command bar search ──────────────────────────────────────────────────────

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    let path = u.pathname.replace(/\/+$/, '') || '/';
    return u.protocol + '//' + u.hostname.replace(/^www\./, '') + path + u.search;
  } catch { return url; }
}

function scoreMatch(query, text) {
  if (!text || !query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 60;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => t.includes(w))) return 40;
  const matched = words.filter((w) => t.includes(w)).length;
  if (matched > 0) return (matched / words.length) * 30;
  return 0;
}

function recencyBoost(timestamp) {
  if (!timestamp) return 1.0;
  const age = Date.now() - timestamp;
  if (age < 3600000) return 1.3;       // < 1 hour
  if (age < 86400000) return 1.15;     // < 24 hours
  if (age < 604800000) return 1.05;    // < 1 week
  return 1.0;
}

// ─── Frecency ─────────────────────────────────────────────────────────────────

async function updateFrecency(url) {
  if (!url) return;
  const { frecency = {} } = await chrome.storage.local.get('frecency');
  const entry = frecency[url] || { visits: 0, lastUsed: 0 };
  entry.visits += 1;
  entry.lastUsed = Date.now();
  frecency[url] = entry;

  const keys = Object.keys(frecency);
  if (keys.length > FRECENCY_MAX) {
    const scored = keys.map((k) => ({
      key: k,
      score: frecency[k].visits * recencyBoost(frecency[k].lastUsed),
    }));
    scored.sort((a, b) => b.score - a.score);
    const keep = new Set(scored.slice(0, FRECENCY_MAX).map((s) => s.key));
    for (const k of keys) {
      if (!keep.has(k)) delete frecency[k];
    }
  }

  await chrome.storage.local.set({ frecency });
}

function frecencyBoost(url, frecency) {
  const entry = frecency[url];
  if (!entry) return 1.0;
  return 1 + Math.log2(entry.visits + 1) * 0.15;
}

function scoreItem(query, item, sourceWeight) {
  const titleScore = scoreMatch(query, item.title) * 3;
  const urlScore = scoreMatch(query, item.url) * 2;
  const descScore = scoreMatch(query, item.description) * 1;
  const matchScore = Math.max(titleScore, urlScore, descScore);
  if (matchScore === 0) return 0;
  return matchScore * sourceWeight * recencyBoost(item.timestamp) * (item.frecencyBoost || 1.0);
}

async function commandBarSearch(query) {
  const q = (query || '').trim();

  const [tabs, archiveData, bookmarks, historyItems, frecencyData, workspaceData] = await Promise.all([
    chrome.tabs.query({}),
    chrome.storage.local.get('archive'),
    q ? chrome.bookmarks.search(q).catch(() => []) : Promise.resolve([]),
    q ? chrome.history.search({ text: q, maxResults: 20 }).catch(() => []) : Promise.resolve([]),
    chrome.storage.local.get('frecency'),
    chrome.storage.local.get('workspaces'),
  ]);
  const frecency = frecencyData.frecency || {};
  const workspaces = workspaceData.workspaces || [];

  const archive = archiveData.archive || [];
  const now = Date.now();

  const openTabItems = tabs.map((t) => ({
    source: 'openTabs',
    title: t.title || t.url,
    url: t.url,
    favIconUrl: t.favIconUrl || '',
    description: '',
    timestamp: t.lastAccessed || now,
    tabId: t.id,
    windowId: t.windowId,
    frecencyBoost: frecencyBoost(t.url, frecency),
  }));

  const archiveItems = archive.map((a) => ({
    source: 'archive',
    title: a.title || a.url,
    url: a.url,
    favIconUrl: a.favIconUrl || '',
    description: a.description || '',
    timestamp: a.archivedAt || 0,
    frecencyBoost: frecencyBoost(a.url, frecency),
  }));

  const bookmarkItems = bookmarks.map((b) => ({
    source: 'bookmarks',
    title: b.title || b.url || '',
    url: b.url || '',
    favIconUrl: '',
    description: '',
    timestamp: b.dateAdded || 0,
    frecencyBoost: frecencyBoost(b.url, frecency),
  })).filter((b) => b.url);

  const historyMapped = historyItems.map((h) => ({
    source: 'history',
    title: h.title || h.url,
    url: h.url,
    favIconUrl: '',
    description: '',
    timestamp: h.lastVisitTime || 0,
    frecencyBoost: frecencyBoost(h.url, frecency),
  }));

  const sourceWeights = { openTabs: 1.5, archive: 1.2, bookmarks: 1.0, history: 0.7, workspaces: 1.1 };

  const workspaceItems = workspaces.map((w) => ({
    source: 'workspaces',
    title: w.name,
    url: '',
    favIconUrl: '',
    description: `${w.tabs.length} tabs`,
    timestamp: w.lastUsed || w.createdAt || 0,
    workspaceName: w.name,
    tabCount: w.tabs.length,
    frecencyBoost: 1.0,
  }));

  // Empty query: show recent open tabs + recent archive items
  if (!q) {
    const recentTabs = openTabItems
      .filter((t) => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);
    const recentArchive = archiveItems
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);
    return {
      openTabs: recentTabs,
      archive: recentArchive,
      bookmarks: [],
      history: [],
    };
  }

  // Score all items
  const all = [
    ...openTabItems.map((item) => ({ ...item, score: scoreItem(q, item, sourceWeights.openTabs) })),
    ...archiveItems.map((item) => ({ ...item, score: scoreItem(q, item, sourceWeights.archive) })),
    ...bookmarkItems.map((item) => ({ ...item, score: scoreItem(q, item, sourceWeights.bookmarks) })),
    ...historyMapped.map((item) => ({ ...item, score: scoreItem(q, item, sourceWeights.history) })),
    ...workspaceItems.map((item) => ({ ...item, score: scoreItem(q, item, sourceWeights.workspaces) })),
  ].filter((item) => item.score > 0);

  // Deduplicate by normalized URL — keep highest score
  const seen = new Map();
  for (const item of all) {
    const key = normalizeUrl(item.url);
    const existing = seen.get(key);
    if (!existing || item.score > existing.score) {
      seen.set(key, item);
    }
  }

  const deduped = [...seen.values()];
  deduped.sort((a, b) => b.score - a.score);

  // Group by source, max 5 each
  const grouped = { openTabs: [], archive: [], bookmarks: [], history: [], workspaces: [] };
  for (const item of deduped) {
    if (grouped[item.source].length < 5) {
      grouped[item.source].push(item);
    }
  }

  return grouped;
}

// ─── Command bar actions ─────────────────────────────────────────────────────

async function commandBarAction(item) {
  if (!item) return;

  if (item.url) updateFrecency(item.url);

  if (item.source === 'openTabs' && item.tabId) {
    await chrome.tabs.update(item.tabId, { active: true });
    await chrome.windows.update(item.windowId, { focused: true });
    return;
  }

  if (item.source === 'archive') {
    await chrome.tabs.create({ url: item.url });
    const { archive = [] } = await chrome.storage.local.get('archive');
    const filtered = archive.filter((a) => !(a.url === item.url && a.archivedAt === item.timestamp));
    await chrome.storage.local.set({ archive: filtered });
    return;
  }

  if (item.source === 'workspaces' && item.workspaceName) {
    await restoreWorkspace(item.workspaceName);
    return;
  }

  await chrome.tabs.create({ url: item.url });
}

// Ensure alarms exist — called on every SW startup and on install
async function ensureAlarms() {
  const [cleanup, clearOld] = await Promise.all([
    chrome.alarms.get(CLEANUP_ALARM),
    chrome.alarms.get(CLEAR_OLD_ALARM),
  ]);
  if (!cleanup) chrome.alarms.create(CLEANUP_ALARM, { periodInMinutes: 15 });
  if (!clearOld) chrome.alarms.create(CLEAR_OLD_ALARM, { periodInMinutes: 60 });
}

chrome.runtime.onInstalled.addListener(() => ensureAlarms());
chrome.runtime.onStartup.addListener(() => ensureAlarms());

// Run ensureAlarms on every SW startup (covers SW wake after idle termination)
ensureAlarms();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...settings };
}

async function getStats() {
  const { archive = [], lastCleanup = null } = await chrome.storage.local.get([
    'archive',
    'lastCleanup',
  ]);
  return { archiveCount: archive.length, lastCleanup };
}

// ─── Core cleanup ─────────────────────────────────────────────────────────────

async function runCleanup() {
  const settings = await getSettings();
  if (!settings.enabled) return { archived: 0, skipped: 'disabled' };

  const thresholdMs = settings.archiveAfterHours * 60 * 60 * 1000;
  const now = Date.now();
  const allTabs = await chrome.tabs.query({});

  const toArchive = [];
  const idsToClose = [];

  for (const tab of allTabs) {
    if (!tab.url) continue;
    if (
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('about:') ||
      tab.url === 'chrome://newtab/'
    )
      continue;

    if (tab.active) continue;
    if (tab.status === 'loading') continue;
    if (tab.pinned && settings.protectPinned) continue;
    if (tab.audible && settings.protectAudible) continue;
    if (tab.groupId !== -1 && settings.protectGrouped) continue;

    const lastAccessed = tab.lastAccessed || 0;
    const idleMs = now - lastAccessed;

    if (idleMs >= thresholdMs) {
      toArchive.push({
        url: tab.url,
        title: tab.title || tab.url,
        favIconUrl: tab.favIconUrl || '',
        archivedAt: now,
        idleMs,
      });
      idsToClose.push(tab.id);
    }
  }

  if (toArchive.length > 0) {
    const { archive = [] } = await chrome.storage.local.get('archive');
    const newArchive = [...toArchive, ...archive].slice(0, ARCHIVE_MAX);
    await chrome.storage.local.set({ archive: newArchive });

    for (const id of idsToClose) {
      try { await chrome.tabs.remove(id); } catch { /* tab already gone */ }
    }

    // Update badge (auto-clears via alarm)
    chrome.action.setBadgeText({ text: String(toArchive.length) });
    chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6' });
    chrome.alarms.create(BADGE_CLEAR_ALARM, { delayInMinutes: 10 });
  }

  await chrome.storage.local.set({ lastCleanup: now });
  return { archived: toArchive.length };
}

// ─── Archive maintenance ───────────────────────────────────────────────────────

async function clearOldArchive() {
  const settings = await getSettings();
  if (settings.clearArchiveAfterDays === 0) return; // "Never"

  const cutoff = Date.now() - settings.clearArchiveAfterDays * 24 * 60 * 60 * 1000;
  const { archive = [] } = await chrome.storage.local.get('archive');
  const filtered = archive.filter((item) => item.archivedAt > cutoff);
  if (filtered.length !== archive.length) {
    await chrome.storage.local.set({ archive: filtered });
  }
}
