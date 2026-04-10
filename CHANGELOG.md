# Changelog

All notable changes to Tuckd will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.1] - 2026-04-10

### Fixed
- Command bar: open a dedicated extension page on `chrome://`, `about:`, other extensions’ pages, and other URLs where injection is blocked (instead of failing or opening the archive).
- Command bar: stop keyboard and composition events from bubbling into the underlying page while typing in the palette.

## [1.1.0] - 2026-04-10

### Added
- Feat: monthly impact stats, refreshed popup and settings UI

### Internal
- Chore: use --no-verify for release version commits on main

### Other
- Merge branch 'dev'
- Trigger release on merge to main instead of manual tag (#2)
- Reorganize source files into src/ folder structure (#1)
- Reorganize source files into src/ folder structure


## [1.0.1] - 2026-04-03

### Internal
- Remove one-time icon generator script
- Add privacy policy and release automation script

## [1.0.0] - 2026-04-03

### Added
- Auto-archive idle tabs on a configurable schedule (1 hour to 30 days)
- Command bar (`Cmd+E` / `Ctrl+E`) for searching tabs, archive, bookmarks, and history
- Quick actions via `>` prefix (close duplicates, focus mode, group by domain)
- Workspace save/restore
- Archive browser with date grouping, search, and bulk clear
- Protection rules for pinned, audible, and grouped tabs
- Frecency-based search ranking
- Dark theme UI with light mode support
- Settings page with live preview
