// Tuckd — Settings page

// If the extension was reloaded while this page was open, the runtime
// context is stale and every chrome.* call will throw. Detect and reload.
if (!chrome.runtime?.id) {
  location.reload();
}

const DEFAULTS = {
  enabled: true,
  archiveAfterHours: 12,
  protectPinned: true,
  protectAudible: true,
  protectGrouped: true,
  clearArchiveAfterDays: 30,
};

let saveTimer = null;

// sendMessage wrapper that retries once after waking the service worker
async function sendMsg(msg) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch {
    // SW was asleep — the failed sendMessage wakes it; retry after a tick
    await new Promise((r) => setTimeout(r, 100));
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch {
      return null;
    }
  }
}

// ─── Shortcut status ──────────────────────────────────────────────────────────
async function checkShortcutStatus() {
  const statusEl = document.getElementById('shortcutStatus');
  const warningEl = document.getElementById('shortcutWarning');

  try {
    const commands = await chrome.commands.getAll();
    const cmd = commands.find((c) => c.name === 'open-command-bar');
    const shortcut = cmd?.shortcut || '';

    if (shortcut) {
      statusEl.textContent = shortcut;
      warningEl.classList.add('hidden');
    } else {
      statusEl.textContent = 'Not assigned';
      warningEl.classList.remove('hidden');
    }
  } catch {
    statusEl.textContent = 'Unable to check';
    warningEl.classList.remove('hidden');
  }
}

// ─── Load settings ─────────────────────────────────────────────────────────────
async function loadSettings() {
  const { settings = {}, archive = [] } = await chrome.storage.local.get([
    'settings',
    'archive',
  ]);
  const s = { ...DEFAULTS, ...settings };

  document.getElementById('enabled').checked = s.enabled;
  document.getElementById('archiveAfterHours').value = String(s.archiveAfterHours);
  document.getElementById('protectPinned').checked = s.protectPinned;
  document.getElementById('protectAudible').checked = s.protectAudible;
  document.getElementById('protectGrouped').checked = s.protectGrouped;
  document.getElementById('clearArchiveAfterDays').value = String(s.clearArchiveAfterDays);

  updateArchiveCount(archive.length);
  updateDisabledState(s.enabled);
}

function updateArchiveCount(count) {
  const desc = document.getElementById('archiveCountDesc');
  desc.textContent =
    count === 0 ? 'No archived tabs' : `${count} tab${count === 1 ? '' : 's'} in archive`;
}

function updateDisabledState(enabled) {
  document.getElementById('archivingCard').classList.toggle('disabled', !enabled);
}

// ─── Save settings ─────────────────────────────────────────────────────────────
async function saveSettings() {
  const s = {
    enabled: document.getElementById('enabled').checked,
    archiveAfterHours: Number(document.getElementById('archiveAfterHours').value),
    protectPinned: document.getElementById('protectPinned').checked,
    protectAudible: document.getElementById('protectAudible').checked,
    protectGrouped: document.getElementById('protectGrouped').checked,
    clearArchiveAfterDays: Number(document.getElementById('clearArchiveAfterDays').value),
  };

  await chrome.storage.local.set({ settings: s });
  updateDisabledState(s.enabled);
  showSaveIndicator();
}

function showSaveIndicator() {
  const el = document.getElementById('saveIndicator');
  el.classList.remove('hidden');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => el.classList.add('hidden'), 1800);
}

// ─── Wire up controls ──────────────────────────────────────────────────────────
function wireControls() {
  const controls = ['enabled', 'archiveAfterHours', 'protectPinned', 'protectAudible', 'protectGrouped', 'clearArchiveAfterDays'];
  for (const id of controls) {
    document.getElementById(id).addEventListener('change', saveSettings);
  }

  // Configure shortcut
  document.getElementById('btnConfigureShortcut').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  // View archive
  document.getElementById('btnViewArchive').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/archive/archive.html') });
  });

  // Footer archive link
  document.getElementById('footerArchiveLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('src/archive/archive.html') });
  });

  // Clear archive
  document.getElementById('btnClearArchive').addEventListener('click', async () => {
    if (!confirm('Clear all archived tabs? This cannot be undone.')) return;
    await chrome.storage.local.set({ archive: [] });
    updateArchiveCount(0);
    showSaveIndicator();
  });

  // Run now
  document.getElementById('btnRunNow').addEventListener('click', async () => {
    const btn = document.getElementById('btnRunNow');
    btn.disabled = true;
    btn.textContent = 'Running…';

    const result = await sendMsg({ action: 'runNow' });

    const count = result?.archived ?? 0;
    btn.textContent = count > 0 ? `Archived ${count}` : 'Nothing to archive';
    btn.classList.add('success');

    // Refresh archive count
    const { archive = [] } = await chrome.storage.local.get('archive');
    updateArchiveCount(archive.length);

    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = 'Run Now';
      btn.classList.remove('success');
    }, 2500);
  });
}

// ─── Init ──────────────────────────────────────────────────────────────────────
loadSettings();
checkShortcutStatus();
wireControls();
