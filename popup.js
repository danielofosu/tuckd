// Tidytabs — Popup

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
}

document.getElementById('btnArchive').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('archive.html') });
  window.close();
});

document.getElementById('btnSettings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

loadPopup();
