// Tuckd — Popup

if (!chrome.runtime?.id) location.reload();

function formatRelativeTime(ms) {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (diff < 60000) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatCountdown(scheduledTime) {
  if (!scheduledTime) return '—';
  const diff = scheduledTime - Date.now();
  if (diff <= 0) return 'soon';
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.ceil(minutes / 60)}h`;
}

function formatEstRamMb(mb) {
  if (mb == null || mb <= 0) return '~0 MB';
  if (mb >= 1024) return `~${(mb / 1024).toFixed(1)} GB freed`;
  return `~${Math.round(mb)} MB freed`;
}

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

async function loadPopup() {
  const statusPill = document.getElementById('statusPill');
  const archiveCount = document.getElementById('archiveCount');
  const nextCheck = document.getElementById('nextCheck');
  const lastCleaned = document.getElementById('lastCleaned');
  const tabsThisMonth = document.getElementById('tabsThisMonth');
  const ramThisMonth = document.getElementById('ramThisMonth');
  const kbdMod = document.getElementById('kbdMod');

  if (kbdMod) {
    kbdMod.textContent = /Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘' : 'Ctrl';
  }

  // Load settings + stats in parallel
  const [{ settings = {} }, statsResp, alarmResp] = await Promise.all([
    chrome.storage.local.get('settings'),
    sendMsg({ action: 'getStats' }),
    sendMsg({ action: 'getNextAlarm' }),
  ]);

  const enabled = settings.enabled !== false;

  statusPill.textContent = enabled ? 'Active' : 'Paused';
  statusPill.className = 'status-pill' + (enabled ? '' : ' paused');

  archiveCount.textContent = statsResp?.archiveCount ?? '0';
  lastCleaned.textContent = formatRelativeTime(statsResp?.lastCleanup);
  nextCheck.textContent = enabled ? formatCountdown(alarmResp?.scheduledTime) : '—';

  const monthTabs = statsResp?.tabsArchivedThisMonth ?? 0;
  tabsThisMonth.textContent = String(monthTabs);
  ramThisMonth.textContent = formatEstRamMb(statsResp?.estRamMbThisMonth);
}

document.getElementById('btnArchive').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/archive/archive.html') });
  window.close();
});

document.getElementById('btnSettings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

loadPopup();
