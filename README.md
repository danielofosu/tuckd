<p align="center">
  <img src="icons/icon128.png" width="80" alt="Tidytabs icon" />
</p>

<h1 align="center">Tidytabs</h1>

<p align="center">
  Keep your browser tidy, automatically.<br/>
  A Chrome extension that archives inactive tabs and lets you restore them anytime.
</p>

<p align="center">
  <a href="https://github.com/creditornot/tidytabs/releases/latest"><img src="https://img.shields.io/github/v/release/creditornot/tidytabs?style=flat-square" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/creditornot/tidytabs?style=flat-square" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/manifest-v3-blue?style=flat-square" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/chrome-120%2B-green?style=flat-square" alt="Chrome 120+" />
</p>

---

## Why

Chrome accumulates tabs. You open 5 for a task, forget about them, and suddenly you have 80. Arc solved this with auto-archive -- tabs you haven't touched in a while quietly close and save themselves for later. Chrome has no native equivalent.

Tidytabs brings that behavior to Chrome: idle tabs get archived automatically, and you can restore any of them with a couple of keystrokes.

## Features

- **Auto-archive** -- tabs not visited for a configurable period (1 hour to 30 days) are closed and saved to a local archive
- **Command bar** (`Cmd+E` / `Ctrl+E`) -- search across open tabs, archived tabs, bookmarks, and history in one place
- **Quick actions** -- type `>` in the command bar for commands like Close Duplicates, Focus Mode, Group by Domain, Save/Restore Workspace
- **Workspaces** -- save your current tab set as a named workspace and restore it later
- **Smart protection** -- pinned tabs, audible tabs (music/calls), and grouped tabs are never archived
- **Frecency ranking** -- search results are ranked by a combination of visit frequency and recency
- **Archive management** -- browse, search, restore, or delete archived tabs; auto-clear after 7/30/90 days or never
- **Zero external dependencies** -- no accounts, no servers, no tracking. Everything stays in `chrome.storage.local`

## Installation

### From GitHub Releases (recommended)

1. Go to [Releases](https://github.com/creditornot/tidytabs/releases/latest)
2. Download `tidytabs-vX.Y.Z.zip`
3. Unzip the file
4. Open `chrome://extensions` in Chrome
5. Enable **Developer mode** (top-right toggle)
6. Click **Load unpacked** and select the unzipped folder

### From source

```bash
git clone https://github.com/creditornot/tidytabs.git
cd tidytabs
```

Then load unpacked in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `tidytabs` directory

No build step required -- the extension is plain JS/HTML/CSS.

## Usage

### Auto-archiving

Once installed, Tidytabs checks every 15 minutes for tabs that have been idle longer than your threshold (default: 12 hours). Matching tabs are archived and closed. A badge shows how many tabs were just archived.

Configure the threshold and protection rules in the settings page (right-click the extension icon > Options).

### Command bar

Press `Cmd+E` (Mac) or `Ctrl+E` (Windows/Linux) on any page to open the command bar.

- **Search** -- type to find open tabs, archived tabs, bookmarks, and browser history
- **Quick actions** -- type `>` to see available commands:
  - `>close duplicates` -- close tabs with the same URL
  - `>focus` -- archive everything except the current tab
  - `>group by domain` -- auto-group tabs by hostname
  - `>save workspace <name>` -- save current tabs as a workspace
  - `>restore workspace <name>` -- restore a saved workspace
- **Navigate** -- arrow keys to move, Enter to open/switch, Esc to close

### Archive page

Click the extension icon > **View Archive**, or use the command bar (`>archive`). Browse archived tabs grouped by date, search them, restore individually, or clear all.

## Permissions

| Permission | Why |
|------------|-----|
| `tabs` | Read tab URLs, titles, and lastAccessed timestamps |
| `tabGroups` | Detect grouped tabs for protection rules |
| `storage` | Store settings, archive, frecency data, and workspaces |
| `alarms` | Schedule periodic cleanup checks |
| `scripting` | Inject the command bar into the active tab |
| `bookmarks` | Search bookmarks from the command bar |
| `history` | Search history from the command bar |

## Development

The extension is plain JavaScript with no build step or dependencies.

```
tidytabs/
  manifest.json        MV3 manifest
  background.js        Service worker: alarms, cleanup, command bar search
  popup.html/js/css    Toolbar popup: status + stats
  settings.html/js/css Settings page
  archive.html/js/css  Archive browser
  command-bar.js/css   Command bar (injected as content script)
  create-icons.py      Generates icons from Python stdlib
  icons/               Extension icons (16/48/128px)
```

### Running tests

Tests use Playwright to launch Chromium with the extension loaded:

```bash
npm install
npm test
```

### Creating a release

Releases are automated via GitHub Actions. To publish a new version:

```bash
# 1. Bump version
npm version patch   # or minor / major

# 2. Push the tag
git push origin main --tags
```

The workflow will:
- Create a zip of the extension (excluding dev files)
- Create a GitHub release with auto-generated notes
- Attach the zip as a release asset

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
