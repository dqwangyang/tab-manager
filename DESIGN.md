# Tab Manager 开发设计文档

## 1. 项目概述

### 1.1 项目简介
**Tab Manager** 是一款基于 Electron 开发的桌面应用程序，用于管理和快速访问浏览器页签，支持登录凭据的安全存储。

### 1.2 技术栈
- **框架**: Electron 28.0.0
- **构建工具**: electron-builder 24.13.3
- **语言**: JavaScript (ES6+)
- **UI**: 原生 HTML/CSS (无框架)
- **存储**: 本地 JSON 文件 + 系统钥匙串 (safeStorage API)

### 1.3 项目目标
- 集中管理多个常用网站页签
- 支持页签分类和快速搜索
- 安全存储网站登录凭据
- 支持数据导入导出
- 保持会话状态（Cookies 共享）

---

## 2. 系统架构

### 2.1 进程模型
```
┌─────────────────────────────────────────────────────────┐
│                    Main Process (main.js)               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │   Window    │  │    IPC      │  │   Native APIs   │ │
│  │  Manager    │  │   Handlers  │  │ (dialog,session) │ │
│  └─────────────┘  └─────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────┘
                           │ IPC
┌─────────────────────────────────────────────────────────┐
│                   Preload Script (preload.js)           │
│              contextBridge → window.tabAPI               │
└─────────────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────┐
│               Renderer Process (app.js)                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │  TabManager │  │   Webview   │  │    UI/DOM       │ │
│  │   Class     │  │   Manager   │  │   Management    │ │
│  └─────────────┘  └─────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 2.2 模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| 主进程 | main.js | 窗口管理、IPC 处理、系统集成 |
| 预加载脚本 | preload.js | 安全桥接、API 暴露 |
| 渲染器 | app.js | 业务逻辑、UI 交互 |
| 样式 | styles.css | 界面样式定义 |
| 视图 | index.html | HTML 结构 |

### 2.3 安全架构
```
webPreferences: {
    nodeIntegration: false,      // 禁用 Node.js 集成
    contextIsolation: true,       // 启用上下文隔离
    preload: path.join(__dirname, 'preload.js'),
    webviewTag: true,            // 启用 webview 标签
    partition: 'persist:my-task-session'  // 共享会话
}
```

---

## 3. 功能模块设计

### 3.1 页签管理

#### 3.1.1 数据模型
```javascript
Tab {
    id: string,           // 唯一标识 "tab_" + timestamp + random
    name: string,         // 页签名称
    url: string,          // 网址
    remark: string,       // 备注（可选）
    createdAt: ISO8601,   // 创建时间
    updatedAt: ISO8601    // 更新时间
}
```

#### 3.1.2 功能列表
| 功能 | 描述 |
|------|------|
| 创建页签 | 新建页签并填写名称、URL、备注 |
| 编辑页签 | 修改现有页签信息 |
| 删除页签 | 删除指定页签（带确认） |
| 选择页签 | 点击切换显示对应 webview |
| 刷新页签 | 重新加载当前页签页面 |
| 搜索页签 | 按名称过滤页签列表 |
| 拖拽排序 | 拖拽调整页签顺序 |
| 右键菜单 | 编辑/删除快捷操作 |

### 3.2 Webview 展示

#### 3.2.1 设计说明
- 使用 Electron `<webview>` 标签嵌入网页
- 每个页签对应一个独立的 webview 实例
- webview 复用机制：切换时显示/隐藏，而非销毁/重建
- 共享 Session 分区，保持 Cookies 登录状态

#### 3.2.2 状态管理
```javascript
webviews: Map<tabId, {
    wrapper: HTMLElement,   // 包装容器
    webview: WebviewElement,// webview 实例
    loading: HTMLElement,  // 加载状态
    error: HTMLElement      // 错误状态
}>
```

#### 3.2.3 加载状态
- `did-start-loading`: 显示加载动画
- `did-finish-load`: 隐藏加载动画，尝试自动填充
- `did-fail-load`: 显示错误信息（错误码非 -3）

### 3.3 凭据管理

#### 3.3.1 存储架构
```
┌──────────────────┐      ┌──────────────────┐
│  User Input      │      │   System          │
│  (username/      │ ──→  │   Keychain        │
│   password)      │      │   (safeStorage)   │
└──────────────────┘      └──────────────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │ credentials.json  │
                        │ (加密存储引用)     │
                        └──────────────────┘
```

#### 3.3.2 凭据数据结构
```javascript
Credential {
    url: string,            // 网站域名
    username: string,       // 用户名
    password: string,      // 加密后的密码 (Base64)
    updatedAt: ISO8601      // 更新时间
}

// 存储键格式: "MyTask:{url}:{username}"
```

#### 3.3.3 自动填充流程
1. Webview 加载完成
2. 获取当前 URL 的域名
3. 查询该域名的保存凭据
4. 执行 JavaScript 注入自动填充表单

### 3.4 数据导入导出

#### 3.4.1 导出格式
```javascript
ExportData {
    version: "1.0",
    exportedAt: ISO8601,
    tabs: Tab[],
    credentials: Credential[]  // 使用导出密钥重新加密
}
```

#### 3.4.2 安全考虑
- 导出时使用 `EXPORT_ENCRYPTION_KEY` 重新加密密码
- 导入时解密后用 `safeStorage` 重新加密存储
- 确保证书链完整传输

---

## 4. IPC 通信设计

### 4.1 通道定义

#### 页签管理
| 通道 | 方向 | 参数 | 返回 |
|------|------|------|------|
| get-tabs | Renderer → Main | - | `{ success, tabs[] }` |
| save-tabs | Renderer → Main | `tabs[]` | `{ success }` |
| export-tabs | Renderer → Main | `tabs[]` | `{ success }` |
| import-tabs | Renderer → Main | - | `{ success, tabs[] }` |

#### 会话管理
| 通道 | 方向 | 参数 | 返回 |
|------|------|------|------|
| get-session-partition | Renderer → Main | - | `string` |
| clear-session-data | Renderer → Main | - | `{ success }` |
| get-cookies | Renderer → Main | - | `{ success, cookies[] }` |

#### 凭据管理
| 通道 | 方向 | 参数 | 返回 |
|------|------|------|------|
| can-store-credentials | Renderer → Main | - | `boolean` |
| save-credential | Renderer → Main | `{ url, username, password }` | `{ success }` |
| get-credential | Renderer → Main | `{ url, username }` | `{ success, credential }` |
| get-usernames-for-url | Renderer → Main | `{ url }` | `{ success, usernames[] }` |
| delete-credential | Renderer → Main | `{ url, username }` | `{ success }` |
| list-credentials | Renderer → Main | - | `{ success, credentials[] }` |

#### 系统集成
| 通道 | 方向 | 参数 | 返回 |
|------|------|------|------|
| open-external | Renderer → Main | `url` | `{ success }` |

### 4.2 错误处理模式
```javascript
// 所有 IPC handlers 统一使用 try-catch
ipcMain.handle('channel', async (event, args) => {
    try {
        // 业务逻辑
        return { success: true, data: result };
    } catch (error) {
        console.error('操作失败:', error.message);
        return { success: false, error: error.message };
    }
});
```

---

## 5. 界面设计

### 5.1 布局结构
```
┌────────────────────────────────────────────────────────────┐
│  macOS Title Bar (隐藏，使用原生 Traffic Lights)            │
├─────────────────┬──────────────────────────────────────────┤
│                 │                                          │
│   Sidebar       │              Content Area                │
│   (280px)       │                                          │
│                 │   ┌──────────────────────────────────┐   │
│  ┌───────────┐  │   │                                  │   │
│  │  Header    │  │   │         Webview Container        │   │
│  │  (拖拽区域) │  │   │                                  │   │
│  └───────────┘  │   │                                  │   │
│                 │   │                                  │   │
│  ┌───────────┐  │   │                                  │   │
│  │ Toolbar   │  │   │                                  │   │
│  │ 新建/导入/ │  │   │                                  │   │
│  │ 导出      │  │   └──────────────────────────────────┘   │
│  └───────────┘  │                                          │
│                 │                                          │
│  ┌───────────┐  │                                          │
│  │  Search   │  │                                          │
│  └───────────┘  │                                          │
│                 │                                          │
│  ┌───────────┐  │                                          │
│  │  Tab List │  │                                          │
│  │           │  │                                          │
│  │  - Tab 1  │  │                                          │
│  │  - Tab 2  │  │                                          │
│  │  - Tab 3  │  │                                          │
│  │           │  │                                          │
│  └───────────┘  │                                          │
│                 │                                          │
└─────────────────┴──────────────────────────────────────────┘
```

### 5.2 配色方案
```css
:root {
    /* 主色调 */
    --primary-color: #3b82f6;      /* 蓝 */
    --primary-hover: #2563eb;
    
    /* 危险色 */
    --danger-color: #ef4444;       /* 红 */
    --danger-hover: #dc2626;
    
    /* 背景色 */
    --bg-dark: #1e1e2e;            /* 主背景 */
    --bg-darker: #181825;          /* 侧边栏背景 */
    --bg-light: #313244;           /* 输入框、按钮背景 */
    
    /* 文字色 */
    --text-primary: #cdd6f4;        /* 主文字 */
    --text-secondary: #a6adc8;     /* 次要文字 */
    --text-muted: #6c7086;         /* 弱化文字 */
    
    /* 边框色 */
    --border-color: #45475a;
    
    /* 状态色 */
    --success-color: #a6e3a1;       /* 成功提示 */
}
```

### 5.3 组件规范

#### CSS 类命名 (BEM)
```css
.block              /* 块级容器 */
.block__element     /* 块内元素 */
.block--modifier    /* 块级修饰符 */

/* 示例 */
.tab-item {}
.tab-item__title {}
.tab-item--active {}
```

#### 组件列表
| 组件 | 类名 | 状态 |
|------|------|------|
| 页签项 | `.tab-item` | default, active, hover, dragging, drag-over, drag-over-bottom |
| 工具栏按钮 | `.toolbar-btn` | default, hover |
| 表单输入 | `.form-input` | default, focus |
| 模态框 | `.modal` | hidden |
| 按钮 | `.btn` | primary, secondary, danger |
| 右键菜单 | `.context-menu` | hidden |
| Toast | (动态创建) | - |

---

## 6. 数据存储

### 6.1 存储路径
```
~/Library/Application Support/my-task/
├── tabs.json          # 页签数据
└── credentials.json   # 凭据引用
```

### 6.2 数据格式

#### tabs.json
```json
[
  {
    "id": "tab_1234567890_abc123",
    "name": "GitHub",
    "url": "https://github.com",
    "remark": "代码仓库",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
]
```

#### credentials.json
```json
{
  "MyTask:https://github.com:username": {
    "url": "https://github.com",
    "username": "username",
    "password": "base64_encrypted_string",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

---

## 7. 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl/Cmd + S` | 保存当前编辑 |
| `Ctrl/Cmd + N` | 新建页签 |
| `Escape` | 关闭模态框/右键菜单 |

---

## 8. 浏览器兼容说明

本应用仅针对 **Electron 内嵌 Chromium** 环境，无需考虑浏览器兼容性。

---

## 9. 未来扩展建议

### 9.1 可添加功能
- 页签分组/文件夹
- 页签图标自动获取
- 导入/导出为 HTML 书签格式
- 暗黑/亮色主题切换
- 多语言支持
- 云同步
- 浏览器扩展

### 9.2 性能优化
- 延迟加载非活跃 webview
- webview 池化复用
- 大列表虚拟滚动
- 页签懒加载

### 9.3 测试覆盖
- 单元测试 (Jest)
- E2E 测试 (Playwright/Electron Testing)
- IPC 通信测试

---

## 10. 版本信息

- **当前版本**: 1.0.0
- **作者**: 兔子哥
- **年份**: 2026
- **许可**: MIT
