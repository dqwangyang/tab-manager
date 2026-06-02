# My Task - Tab Manager

> Personal browser tab manager with secure credential storage

[中文版本](README.md)

---

## 📝 Introduction

My Task is an Electron-based desktop app that helps you centrally manage and quickly access your frequently-used website tabs, with secure credential storage and one-click auto-fill. All data is stored locally — no internet connection required.

## ✨ Features

- **Tab Management**: Quickly add, edit, delete, search, and drag-to-sort frequently-used websites
- **Folder Grouping**: Organize tabs into folders with expand/collapse support
- **Embedded Browser**: Browse websites directly via built-in webview
- **Credential Management**: Encrypted storage via system keychain, auto-fill login forms
- **Session Persistence**: Share cookies and login states across tabs
- **Import/Export**: Export and import tabs with encrypted credentials
- **Fully Offline**: All data stored locally, no cloud dependency

## 📦 Download

### macOS
- Build from source: `git clone https://github.com/dqwangyang/tab-manager.git && npm install && npm run build`

## 🔧 Development

```bash
npm install
npm run dev
npm run build
```

## 🏗️ Tech Stack

- **Framework**: Electron 28
- **Frontend**: Vanilla JavaScript (ES6+)
- **Styling**: CSS Custom Properties (Catppuccin Mocha dark theme)
- **Security**: contextIsolation, safeStorage
- **Packaging**: electron-builder

## 📄 License

MIT License

---

## ❤️ Support the Author

If you find this tool useful, feel free to scan the QR code to support the author ❤️

![Alipay Donation QR](paycode.jpg)

Thank you for your support! 🙏
