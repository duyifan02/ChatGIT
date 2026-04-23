# ChatGit

> Visualize, restore, and navigate ChatGPT conversation branches in Chrome and Firefox.

## Overview

The project uses one shared content-script implementation with browser-specific manifests and generated builds for:

- `dist/chrome/`
- `dist/firefox/`

Source of truth lives in:

- `src/content.js`
- `src/content.css`
- `src/manifests/manifest.chrome.json`
- `src/manifests/manifest.firefox.json`

Static assets live in:

- `src/assets/`

## Build

Build both browser targets with:

```bash
npm run build
```

or:

```bash
bash build.sh
```

The build script:

- copies `src/content.js` and `src/content.css`
- copies everything under `src/assets/`
- writes browser-specific `manifest.json`

Do not edit files under `dist/` directly.

## Install

### Chrome / Edge

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `dist/chrome/`

### Firefox

1. Open `about:debugging`
2. Choose `This Firefox`
3. Click `Load Temporary Add-on`
4. Select `dist/firefox/manifest.json`

## Project Structure

```text
ChatGIT/
|-- src/
|   |-- content.js
|   |-- content.css
|   |-- assets/
|   |   `-- icons/
|   `-- manifests/
|       |-- manifest.chrome.json
|       `-- manifest.firefox.json
|-- scripts/
|   `-- build.mjs
|-- dist/
|   |-- chrome/
|   `-- firefox/
|-- build.sh
|-- package.json
`-- README.md
```

## Runtime Design

### Stable branch navigation

The extension no longer relies on fragile "find the nearest button and click it" behavior as the main strategy.

Current navigation flow:

- use `data-testid` like `conversation-turn-7` as the stable position identifier
- build a page-level reply switcher index that maps each turn to its version switcher
- read branch/version state from that index first
- use scored button selection as fallback instead of "first matching button wins"
- keep a final DOM-based fallback only as a safety net

This makes branch restoration more robust when:

- `data-message-id` changes across versions
- `1/2` and `2/2` text shifts visually
- nearby turns have similar `Previous response` / `Next response` buttons

### Theme and overlay behavior

The content UI also includes:

- automatic light/dark theme detection
- status toast attached to the extension root instead of floating over the page body
- pointer-event isolation so native ChatGPT controls remain hoverable and clickable

## Maintenance Notes

- `scripts/build.mjs` is the single build entry for both browsers.
- If you add more extension surfaces later, such as `background`, `popup`, or `options`, extend the build script instead of hand-editing `dist/`.
- If branch navigation regresses again, start by checking the reply switcher index and scored fallback in `src/content.js`.
