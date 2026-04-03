# Contributing to Tidytabs

Thanks for your interest in contributing!

## Getting started

1. Fork the repo and clone it
2. Load the extension in Chrome (`chrome://extensions` > Developer mode > Load unpacked)
3. Make your changes -- no build step needed
4. Test manually by reloading the extension

## Pull requests

- Keep PRs focused on a single change
- Update the README if you're adding a feature
- Test on Chrome 120+ (MV3 is required)
- Follow the existing code style (no framework, vanilla JS, minimal abstraction)

## Reporting bugs

Open an issue with:
- What you expected to happen
- What actually happened
- Chrome version and OS
- Steps to reproduce

## Feature requests

Open an issue describing the use case. Tidytabs aims to stay simple and focused -- not every feature request will be accepted, but all are welcome for discussion.

## Code style

- Plain JavaScript, no TypeScript, no bundler
- Minimal abstractions -- prefer inline logic over utility functions for one-off operations
- All state in `chrome.storage.local`
- CSS custom properties for theming
- Comments only where the logic isn't obvious

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
