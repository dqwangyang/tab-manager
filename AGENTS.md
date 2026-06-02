# AGENTS.md - Tab Manager Development Guide

This document provides guidance for agentic coding agents working in this repository.

## Project Overview

**Tab Manager** is an Electron-based desktop application for managing browser tabs with credential storage.

- **Type**: Electron desktop app (JavaScript/Node.js)
- **Main entry**: `main.js` (main process), `app.js` (renderer), `preload.js` (IPC bridge)
- **Data storage**: JSON files in user's app data directory
- **No testing framework**: No automated tests exist

---

## Build, Run, and Test Commands

### Development
```bash
npm run dev     # Start the Electron app in development mode
npm start       # Same as dev
```

### Build
```bash
npm run build           # Build macOS app (dmg + zip)
npm run build:dmg        # Build macOS dmg only
npm run build:zip        # Build macOS zip only
```

Output goes to `dist/` directory.

### Testing
**No testing framework is currently configured.** If adding tests:
- Install Jest: `npm install --save-dev jest`
- Add to package.json scripts: `"test": "jest"`
- Run single test file: `npm test -- <filename>`

---

## Code Style Guidelines

### JavaScript Style

**Indentation**: 4 spaces (no tabs)

**Naming Conventions**:
| Type | Convention | Example |
|------|------------|---------|
| Functions | camelCase | `createWindow`, `handleDrop` |
| Classes | PascalCase | `TabManager` |
| Constants | UPPER_SNAKE_CASE | `SERVICE_NAME`, `EXPORT_ENCRYPTION_KEY` |
| CSS classes | kebab-case | `sidebar-header`, `tab-item` |
| Variables | camelCase | `mainWindow`, `dataPath` |
| Private class members | this.* prefix | `this.tabs`, `this.activeTabId` |

**File Organization**:
```
main.js      # Electron main process, IPC handlers, native APIs
app.js       # Renderer logic, TabManager class, UI management
preload.js   # Context bridge, IPC exposure
styles.css   # All styles
index.html   # Single HTML entry point
```

### Import Pattern

Use CommonJS `require()` syntax (Electron requirement):
```javascript
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
```

### IPC Communication Pattern

**Main process** (main.js):
```javascript
ipcMain.handle('channel-name', async (event, args) => {
    try {
        // logic
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});
```

**Preload** (preload.js):
```javascript
contextBridge.exposeInMainWorld('tabAPI', {
    methodName: (args) => ipcRenderer.invoke('channel-name', args)
});
```

**Renderer** (app.js):
```javascript
const result = await window.tabAPI.methodName(args);
if (result.success) {
    // handle success
} else {
    console.error(result.error);
}
```

### Error Handling

- Always wrap IPC handlers in try-catch
- Return `{ success: boolean, error?: string }` pattern
- Log errors with meaningful context: `console.log('操作失败:', e.message)`
- Use graceful fallbacks where appropriate

### CSS Guidelines

- Use CSS custom properties (variables) from `:root`
- Use flexbox/grid for layouts, avoid floats
- Group related selectors
- Order properties: display > positioning > sizing > colors > typography
- Use BEM-like naming: `.block`, `.block__element`, `.block--modifier`

```css
:root {
    --primary-color: #3b82f6;
    --bg-dark: #1e1e2e;
    --text-primary: #cdd6f4;
}

.sidebar-header {
    display: flex;
    align-items: center;
    padding: 24px 20px;
    background-color: var(--bg-dark);
    color: var(--text-primary);
}
```

### HTML Guidelines

- Use semantic elements (`<aside>`, `<main>`, `<button>`)
- Include `lang` attribute
- Use Content Security Policy meta tag
- Keep inline styles minimal (prefer CSS classes)
- Use `data-*` attributes for JavaScript hooks

---

## Architecture Notes

### Main Process Responsibilities
- Window creation and management
- IPC handlers for file operations
- Native API access (dialog, safeStorage, session)
- Menu creation

### Renderer Process Responsibilities
- UI rendering and updates
- User interaction handling
- Tab state management
- Webview management

### Preload Script Responsibilities
- Secure IPC bridge (contextIsolation)
- Expose safe APIs to renderer via `window.tabAPI`

### Data Flow
```
Renderer (app.js) <--window.tabAPI--> Preload (preload.js) <--IPC--> Main (main.js) --> File System
```

---

## Security Considerations

- **Never** set `nodeIntegration: true` in webPreferences
- Always use `contextIsolation: true`
- Validate all IPC arguments before use
- Use `safeStorage` API for credential encryption
- External URLs should use `shell.openExternal()` for safety

---

## Common Patterns

### Creating a new IPC channel
1. Add handler in `main.js`: `ipcMain.handle('channel', ...)`
2. Add bridge in `preload.js`: `contextBridge.exposeInMainWorld('tabAPI', { ... })`
3. Call from renderer: `await window.tabAPI.channel(args)`

### Adding a new tab property
1. Define in tab creation (app.js `createTab()`)
2. Add to edit modal (index.html)
3. Handle save logic (app.js `saveCurrentTab()`)
4. Persist to JSON (main.js `save-tabs` handler)

### Adding CSS styling
1. Add class to HTML or use existing class
2. Define in styles.css using CSS variables
3. Follow BEM naming for new components

---

## File Structure

```
tab-manager/
├── main.js          # Main process entry
├── app.js           # Renderer application logic
├── preload.js       # Context bridge for IPC
├── index.html       # Single HTML entry point
├── styles.css       # All styles
├── package.json     # Dependencies and scripts
├── dist/            # Build output
└── node_modules/    # Dependencies
```

---

## Version

Current: 1.0.0
Author: 兔子哥
