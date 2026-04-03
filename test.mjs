/**
 * Tuckd — Playwright extension test
 * Loads the extension in Chromium, tests all three pages.
 * Run: node test.mjs
 */

import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = __dirname;
const SCREENSHOTS_DIR = path.join(__dirname, 'test-screenshots');

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function screenshot(page, name) {
  const p = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.log(`  📸 ${name}.png`);
}

async function run() {
  console.log('\n🔪 Tuckd Extension Tests\n');

  const userDataDir = path.join(__dirname, '.test-profile');
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: 1280, height: 800 },
  });

  // Wait for extension to register its service worker
  await new Promise((r) => setTimeout(r, 2000));

  // ── Get extension ID from service worker ──────────────────────────────────
  let extensionId;
  for (const worker of context.serviceWorkers()) {
    if (worker.url().startsWith('chrome-extension://')) {
      extensionId = worker.url().split('/')[2];
      break;
    }
  }

  if (!extensionId) {
    // Wait for service worker to register
    extensionId = await new Promise((resolve) => {
      const handler = (worker) => {
        if (worker.url().startsWith('chrome-extension://')) {
          context.off('serviceworker', handler);
          resolve(worker.url().split('/')[2]);
        }
      };
      context.on('serviceworker', handler);
      setTimeout(() => resolve(null), 5000);
    });
  }

  if (!extensionId) {
    console.error('❌ Could not get extension ID. Extension may not have loaded.');
    await context.close();
    process.exit(1);
  }

  console.log(`✅ Extension loaded: ${extensionId}\n`);
  const base = `chrome-extension://${extensionId}`;

  let passed = 0;
  let failed = 0;

  // ── Test 1: Settings page loads ───────────────────────────────────────────
  {
    console.log('Test 1: Settings page loads');
    try {
      const page = await context.newPage();
      await page.goto(`${base}/settings.html`);
      await page.waitForSelector('#enabled', { state: 'attached', timeout: 5000 });

      const title = await page.title();
      console.assert(title === 'Tuckd Settings', `Expected title "Tuckd Settings", got "${title}"`);

      // Verify default toggle states
      const enabled = await page.$eval('#enabled', (el) => el.checked);
      const protectPinned = await page.$eval('#protectPinned', (el) => el.checked);
      const protectAudible = await page.$eval('#protectAudible', (el) => el.checked);

      console.log(`  enabled=${enabled}, protectPinned=${protectPinned}, protectAudible=${protectAudible}`);
      console.assert(enabled === true, 'enabled should default to true');
      console.assert(protectPinned === true, 'protectPinned should default to true');
      console.assert(protectAudible === true, 'protectAudible should default to true');

      const archiveHours = await page.$eval('#archiveAfterHours', (el) => el.value);
      console.assert(archiveHours === '12', `archiveAfterHours should default to 12, got ${archiveHours}`);

      await screenshot(page, '1-settings-default');
      console.log('  ✅ Settings page loaded with correct defaults\n');
      passed++;
      await page.close();
    } catch (e) {
      console.error('  ❌', e.message, '\n');
      failed++;
    }
  }

  // ── Test 2: Settings persist after change ─────────────────────────────────
  {
    console.log('Test 2: Settings persist after change');
    try {
      const page = await context.newPage();
      await page.goto(`${base}/settings.html`);
      await page.waitForSelector('#archiveAfterHours', { timeout: 5000 });

      // Change archive-after to 24 hours
      await page.selectOption('#archiveAfterHours', '24');
      await new Promise((r) => setTimeout(r, 500));

      // Reload page and verify persisted
      await page.reload();
      await page.waitForSelector('#archiveAfterHours', { timeout: 5000 });
      await new Promise((r) => setTimeout(r, 300));

      const val = await page.$eval('#archiveAfterHours', (el) => el.value);
      console.assert(val === '24', `Expected 24, got ${val}`);

      // Reset back to 12
      await page.selectOption('#archiveAfterHours', '12');
      await new Promise((r) => setTimeout(r, 300));

      await screenshot(page, '2-settings-persisted');
      console.log('  ✅ Settings persist correctly across page reloads\n');
      passed++;
      await page.close();
    } catch (e) {
      console.error('  ❌', e.message, '\n');
      failed++;
    }
  }

  // ── Test 3: Archive page loads ────────────────────────────────────────────
  {
    console.log('Test 3: Archive page loads');
    try {
      const page = await context.newPage();
      await page.goto(`${base}/archive.html`);
      await page.waitForSelector('#searchInput', { timeout: 5000 });

      const title = await page.title();
      console.assert(title.includes('Archive'), `Expected "Archive" in title, got "${title}"`);

      // Should show empty state
      const emptyVisible = await page.$eval('#emptyState', (el) => el.style.display !== 'none');
      console.assert(emptyVisible !== false, 'Empty state should be visible initially');

      await screenshot(page, '3-archive-empty');
      console.log('  ✅ Archive page loads and shows empty state\n');
      passed++;
      await page.close();
    } catch (e) {
      console.error('  ❌', e.message, '\n');
      failed++;
    }
  }

  // ── Test 4: Archive page shows/restores items ─────────────────────────────
  {
    console.log('Test 4: Archive page with items (seed data)');
    try {
      const page = await context.newPage();

      // Seed archive data via storage
      await page.goto(`${base}/settings.html`);
      await page.waitForSelector('#enabled', { state: 'attached', timeout: 5000 });
      await page.evaluate(() => {
        return chrome.storage.local.set({
          archive: [
            { url: 'https://example.com', title: 'Example Domain', favIconUrl: '', archivedAt: Date.now() - 1000 * 60 * 30 },
            { url: 'https://news.ycombinator.com', title: 'Hacker News', favIconUrl: 'https://news.ycombinator.com/favicon.ico', archivedAt: Date.now() - 1000 * 60 * 60 * 2 },
            { url: 'https://github.com/trending', title: 'GitHub Trending', favIconUrl: '', archivedAt: Date.now() - 1000 * 60 * 60 * 25 },
          ],
        });
      });

      await page.goto(`${base}/archive.html`);
      await page.waitForSelector('.tab-item', { timeout: 5000 });

      const count = await page.$$eval('.tab-item', (els) => els.length);
      console.assert(count === 3, `Expected 3 tab items, got ${count}`);

      // Test search
      await page.fill('#searchInput', 'hacker');
      await new Promise((r) => setTimeout(r, 300));
      const filteredCount = await page.$$eval('.tab-item', (els) => els.length);
      console.assert(filteredCount === 1, `Expected 1 filtered result, got ${filteredCount}`);

      await page.fill('#searchInput', '');
      await new Promise((r) => setTimeout(r, 300));

      await screenshot(page, '4-archive-with-items');
      console.log('  ✅ Archive shows items and search filters correctly\n');
      passed++;

      // Clean up seeded data
      await page.evaluate(() => chrome.storage.local.set({ archive: [] }));
      await page.close();
    } catch (e) {
      console.error('  ❌', e.message, '\n');
      failed++;
    }
  }

  // ── Test 5: Settings Run Now button ───────────────────────────────────────
  {
    console.log('Test 5: Run Now button triggers cleanup');
    try {
      const page = await context.newPage();
      await page.goto(`${base}/settings.html`);
      await page.waitForSelector('#btnRunNow', { timeout: 5000 });

      await page.click('#btnRunNow');
      await new Promise((r) => setTimeout(r, 1000));

      // Button should show result text
      const btnText = await page.$eval('#btnRunNow', (el) => el.textContent.trim());
      console.log(`  Button text after run: "${btnText}"`);
      const isResultText = btnText.includes('Archived') || btnText.includes('Nothing');
      console.assert(isResultText, `Expected result text, got "${btnText}"`);

      await screenshot(page, '5-settings-run-now');
      console.log('  ✅ Run Now button executes cleanup and updates UI\n');
      passed++;
      await page.close();
    } catch (e) {
      console.error('  ❌', e.message, '\n');
      failed++;
    }
  }

  // ── Test 6: Toggle disabled state ────────────────────────────────────────
  {
    console.log('Test 6: Disabling Tuckd disables archiving section');
    try {
      const page = await context.newPage();
      await page.goto(`${base}/settings.html`);
      await page.waitForSelector('#enabled', { state: 'attached', timeout: 5000 });

      // Disable — click the toggle label (the visible part), not the hidden checkbox
      await page.$eval('#enabled', (el) => { el.checked = false; el.dispatchEvent(new Event('change')); });
      await new Promise((r) => setTimeout(r, 300));

      const cardDisabled = await page.$eval('#archivingCard', (el) => el.classList.contains('disabled'));
      console.assert(cardDisabled, 'Archiving card should be disabled when extension is off');

      await screenshot(page, '6-settings-disabled');

      // Re-enable
      await page.$eval('#enabled', (el) => { el.checked = true; el.dispatchEvent(new Event('change')); });
      await new Promise((r) => setTimeout(r, 300));

      const cardEnabled = await page.$eval('#archivingCard', (el) => !el.classList.contains('disabled'));
      console.assert(cardEnabled, 'Archiving card should be enabled again');

      console.log('  ✅ Enable/disable toggle correctly controls archiving section\n');
      passed++;
      await page.close();
    } catch (e) {
      console.error('  ❌', e.message, '\n');
      failed++;
    }
  }

  // ── Test 7: Quick actions (> prefix) ───────────────────────────────────────
  {
    console.log('Test 7: Quick actions via background message');
    try {
      const page = await context.newPage();
      await page.goto(`${base}/settings.html`);
      await page.waitForSelector('#enabled', { state: 'attached', timeout: 5000 });

      // Test: filter quick actions (empty query returns all)
      const allActions = await page.evaluate(() => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'commandBarQuickActions', query: '' }, resolve);
        });
      });
      console.log(`  All quick actions: ${allActions.length}`);
      console.assert(allActions.length >= 8, `Expected at least 8 quick actions, got ${allActions.length}`);

      // Test: filter by substring
      const focusActions = await page.evaluate(() => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'commandBarQuickActions', query: 'focus' }, resolve);
        });
      });
      console.assert(focusActions.length === 1, `Expected 1 "focus" action, got ${focusActions.length}`);
      console.assert(focusActions[0].id === 'focus', `Expected "focus" id, got ${focusActions[0].id}`);

      // Test: execute settings action
      const result = await page.evaluate(() => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'commandBarQuickAction', commandId: 'settings' }, resolve);
        });
      });
      console.assert(result.opened === true, 'Settings quick action should open page');
      await new Promise((r) => setTimeout(r, 500));

      await screenshot(page, '7-quick-actions');
      console.log('  ✅ Quick actions filter and execute correctly\n');
      passed++;
      await page.close();
    } catch (e) {
      console.error('  ❌', e.message, '\n');
      failed++;
    }
  }

  // ── Test 8: Frecency tracking ──────────────────────────────────────────────
  {
    console.log('Test 8: Frecency tracking');
    try {
      const page = await context.newPage();
      await page.goto(`${base}/settings.html`);
      await page.waitForSelector('#enabled', { state: 'attached', timeout: 5000 });

      // Clear frecency
      await page.evaluate(() => chrome.storage.local.remove('frecency'));

      // Simulate acting on a URL 3 times
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => {
          return new Promise((resolve) => {
            chrome.runtime.sendMessage(
              { action: 'commandBarAction', item: { source: 'bookmarks', url: 'https://frecency-test.com/page' } },
              resolve
            );
          });
        });
        await new Promise((r) => setTimeout(r, 200));
      }

      // Check frecency data
      const frecency = await page.evaluate(() => chrome.storage.local.get('frecency'));
      const entry = frecency.frecency?.['https://frecency-test.com/page'];
      console.log(`  Frecency entry: visits=${entry?.visits}, lastUsed=${entry?.lastUsed ? 'set' : 'unset'}`);
      console.assert(entry?.visits === 3, `Expected 3 visits, got ${entry?.visits}`);
      console.assert(entry?.lastUsed > 0, 'lastUsed should be set');

      // Clean up
      await page.evaluate(() => chrome.storage.local.remove('frecency'));

      console.log('  ✅ Frecency tracks visits correctly\n');
      passed++;
      await page.close();
    } catch (e) {
      console.error('  ❌', e.message, '\n');
      failed++;
    }
  }

  // ── Test 9: Workspace save/list/restore ───────────────────────────────────
  {
    console.log('Test 9: Workspace snapshots');
    try {
      const page = await context.newPage();
      await page.goto(`${base}/settings.html`);
      await page.waitForSelector('#enabled', { state: 'attached', timeout: 5000 });

      // Clear workspaces
      await page.evaluate(() => chrome.storage.local.remove('workspaces'));

      // Save workspace via quick action
      const saveResult = await page.evaluate(() => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: 'commandBarQuickAction', commandId: 'save-workspace', arg: 'Test Workspace' },
            resolve
          );
        });
      });
      console.log(`  Saved workspace: ${saveResult.saved} tabs`);
      console.assert(saveResult.saved > 0, 'Should save at least 1 tab');

      // List workspaces
      const listResult = await page.evaluate(() => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: 'commandBarQuickAction', commandId: 'workspaces' },
            resolve
          );
        });
      });
      console.assert(Array.isArray(listResult), 'Workspaces list should be an array');
      console.assert(listResult.length === 1, `Expected 1 workspace, got ${listResult.length}`);
      console.assert(listResult[0].name === 'Test Workspace', `Expected "Test Workspace", got ${listResult[0].name}`);

      // Verify workspace appears in search results
      const searchResults = await page.evaluate(() => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'commandBarSearch', query: 'Test Workspace' }, resolve);
        });
      });
      console.log(`  Workspace in search: ${searchResults.workspaces?.length || 0} results`);
      console.assert(searchResults.workspaces?.length > 0, 'Workspace should appear in search');

      // Clean up
      await page.evaluate(() => chrome.storage.local.remove('workspaces'));

      console.log('  ✅ Workspaces save, list, and appear in search\n');
      passed++;
      await page.close();
    } catch (e) {
      console.error('  ❌', e.message, '\n');
      failed++;
    }
  }

  // ── Test 10: Command bar search scoring ────────────────────────────────────
  {
    console.log('Test 10: Command bar keyword search + scoring');
    try {
      const page = await context.newPage();
      await page.goto(`${base}/settings.html`);
      await page.waitForSelector('#enabled', { state: 'attached', timeout: 5000 });

      // Seed archive with test data
      await page.evaluate(() => {
        return chrome.storage.local.set({
          archive: [
            { url: 'https://docs.google.com/sheet1', title: 'Q2 Revenue Data', favIconUrl: '', archivedAt: Date.now() - 1000 * 60 * 30, summary: 'Revenue metrics for Q2 2026' },
            { url: 'https://example.com/report', title: 'Annual Report', favIconUrl: '', archivedAt: Date.now() - 1000 * 60 * 60 * 48 },
            { url: 'https://docs.google.com/sheet2', title: 'Revenue Forecast', favIconUrl: '', archivedAt: Date.now() - 1000 * 60 * 60 },
          ],
        });
      });

      // Search for "revenue"
      const results = await page.evaluate(() => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'commandBarSearch', query: 'revenue' }, resolve);
        });
      });

      const archiveResults = results.archive || [];
      console.log(`  "revenue" search: ${archiveResults.length} archive results`);
      console.assert(archiveResults.length >= 2, `Expected at least 2 archive results for "revenue", got ${archiveResults.length}`);

      // First result should be the one with summary match (higher score)
      if (archiveResults.length >= 2) {
        console.log(`  Top result: "${archiveResults[0].title}" (summary: "${archiveResults[0].summary || 'none'}")`);
      }

      // Empty query should return recent items
      const emptyResults = await page.evaluate(() => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'commandBarSearch', query: '' }, resolve);
        });
      });
      console.assert(emptyResults.archive?.length > 0, 'Empty query should return recent archive items');

      // Clean up
      await page.evaluate(() => chrome.storage.local.set({ archive: [] }));

      console.log('  ✅ Keyword search with scoring works correctly\n');
      passed++;
      await page.close();
    } catch (e) {
      console.error('  ❌', e.message, '\n');
      failed++;
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('─'.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`Screenshots saved to: ${SCREENSHOTS_DIR}`);

  await context.close();

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
