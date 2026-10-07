# Connection Folders

A [Lumiverse Spindle](https://github.com/interesting-critter/Lumiverse) extension that adds collapsible
folders to the Connections tab, making connection profiles easier to sort.

## Features

- Group connections into collapsible folders inside the Connections tab.
- The same folders also appear in the chat composer's connections popover (expand/collapse only —
  renaming and deleting stay in the drawer tab).
- Collapse and expand folders to keep long connection lists manageable.
- Folder state is remembered locally, so your layout survives a page reload.
- **Frontend-only.** The extension has no backend entry point and requests **zero Spindle permissions**.

## Installation

Install from GitHub in Lumiverse using this URL:

```
https://github.com/interesting-critter/Connection-Folders
```

No permissions are requested, and nothing needs to be configured after install.

## Development

```bash
bun install
bun run check   # typecheck + build + tests
```

Build output is written to `dist/frontend.js`, which is what `spindle.json` points at.

> Note: `typescript` is pinned to `5.9.3` rather than tracking the `7.x` native-preview line.
> TypeScript 7 ships its compiler as per-platform native binaries
> (`@typescript/typescript-<platform>-<arch>`), and there is no Android/Termux build of that
> package on the registry, so `tsc` cannot start on those hosts. 5.x's plain-JavaScript `tsc`
> runs everywhere. Raise this pin only once TypeScript publishes an Android binary.