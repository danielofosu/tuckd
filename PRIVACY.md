# Privacy Policy — Tuckd

**Last updated:** April 2026

## Data Collection

**Tuckd does not collect, transmit, or share any user data.**

All data processed by this extension remains entirely on your device in `chrome.storage.local`. Nothing is sent to any server, third party, or external service.

## Permissions Explained

| Permission | What it's used for |
|---|---|
| `tabs` | Reads tab URLs, titles, and last-accessed times to identify idle tabs for archiving. |
| `tabGroups` | Detects grouped tabs so they can be excluded from auto-archiving. |
| `storage` | Saves your settings, archived tabs, frecency scores, and workspaces locally. |
| `alarms` | Runs the cleanup check every 15 minutes to find tabs that exceed your idle threshold. |
| `scripting` | Injects the command bar UI into the active page when you press `Cmd+E` / `Ctrl+E`. |
| `bookmarks` | Lets you search your bookmarks from the command bar. |
| `history` | Lets you search your browser history from the command bar. |
| `<all_urls>` host permission | Required to inject the command bar into any page and to read tab URLs for archiving decisions. |

## Remote Code

This extension contains no remote code. All JavaScript, CSS, and HTML files are bundled locally within the extension package. No external scripts, libraries, CDNs, or analytics services are loaded at runtime.

## Third Parties

Tuckd has zero third-party dependencies. No analytics, no tracking, no advertising, no telemetry.

## Contact

For questions or concerns, open an issue at [github.com/danielofosu/tuckd](https://github.com/danielofosu/tuckd).
