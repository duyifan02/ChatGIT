# ChatGit

> **Visualize and navigate the ChatGPT conversation tree.**  
> Jump across branches instantly — no more getting lost in long, forked chats.

## Features

- **Tree visualization** — renders your full conversation tree with branch connectors
- **Active path highlight** — the current live path is always highlighted
- **Branch navigation** — click any node to jump to it, automatically switching reply versions along the way
- **Branch count indicator** — subtle `current/total` tag on branching nodes
- **Debug mode** — toggleable log panel with pause/copy for diagnostics
- **Persistent cache** — tree state is saved per conversation in `localStorage`

## Install

### Chrome / Edge

1. Go to `chrome://extensions` → enable **Developer mode**
2. Click **Load unpacked** → select the `dist/chrome/` folder

### Firefox

1. Go to `about:debugging` → **This Firefox** → **Load Temporary Add-on**
2. Select `dist/firefox/manifest.json`

## Development

Edit files in `src/` only. Run the build script to sync to both browser targets:

```bash
# Sync src → dist (both browsers)
bash build.sh

# Sync + create release zips
bash build.sh --zip
```

### Project Structure

```
chatgit/
├── src/                  # Single source of truth
│   ├── content.js        # Extension logic
│   ├── content.css       # UI styles
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── dist/
│   ├── chrome/           # Chrome/Edge build (load this folder)
│   │   ├── manifest.json
│   │   ├── content.js    # copied by build.sh
│   │   ├── content.css   # copied by build.sh
│   │   └── icons/
│   └── firefox/          # Firefox build
│       ├── manifest.json
│       ├── content.js    # copied by build.sh
│       ├── content.css   # copied by build.sh
│       └── icons/
├── build.sh
├── .gitignore
└── README.md
```

## How It Works

Each user turn in the conversation is a tree node. When a message has been edited (creating multiple reply versions), the tree branches. The extension:

1. **Captures** all visible user turns on each DOM mutation
2. **Assigns stable IDs** using `data-testid` (position-based, survives version switches)
3. **Navigates** by walking the ancestor chain, switching reply versions at each branching point, then cycling the target's own version selector if needed

## Debug Mode

Click **调试** in the panel header to open the live log panel. Use **⏸** to pause scrolling and **📋** to copy the full log.
