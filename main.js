const { app, BrowserWindow, ipcMain, Menu, dialog, safeStorage, session, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
const SERVICE_NAME = 'MyTask';
const dataPath = path.join(app.getPath('userData'), 'my-task', 'tabs.json');
const credentialsPath = path.join(app.getPath('userData'), 'my-task', 'credentials.json');

// 共享的 session 名称（用于所有 webview）
const SHARED_SESSION_NAME = 'persist:my-task-session';

// 导出加密密钥（用于导出时加密密码）
const EXPORT_ENCRYPTION_KEY = 'MyTask-Export-2026';

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webviewTag: true,
            // 使用共享 session
            partition: SHARED_SESSION_NAME
        },
        titleBarStyle: 'hiddenInset',
        show: false,
        // 设置 Dock 图标
        icon: path.join(__dirname, 'icon.png')
    });

    mainWindow.loadFile('index.html');

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // 设置 Dock 图标（macOS）
    if (process.platform === 'darwin') {
        try {
            const iconPath = path.join(__dirname, 'icon.png');
            if (fs.existsSync(iconPath)) {
                const icon = nativeImage.createFromPath(iconPath);
                app.dock.setIcon(icon);
            }
        } catch (e) {
            console.log('设置 Dock 图标失败:', e.message);
        }
    }

    createMenu();
}

function createMenu() {
    const template = [
        {
            label: 'My Task',
            submenu: [
                { 
                    label: '关于 My Task',
                    click: () => {
                        const { dialog } = require('electron');
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: '关于 My Task',
                            message: 'My Task',
                            detail: '版本: 1.0.0\n作者: 兔子哥\n年份: 2026\n\n个人浏览器页签管理工具',
                            buttons: ['确定']
                        });
                    }
                },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: '编辑',
            submenu: [
                { role: 'undo', label: '撤销' },
                { role: 'redo', label: '重做' },
                { type: 'separator' },
                { role: 'cut', label: '剪切' },
                { role: 'copy', label: '复制' },
                { role: 'paste', label: '粘贴' },
                { role: 'selectAll', label: '全选' }
            ]
        },
        {
            label: '视图',
            submenu: [
                { role: 'reload', label: '重新加载' },
                { role: 'toggleDevTools', label: '开发者工具' },
                { type: 'separator' },
                { role: 'resetZoom', label: '重置缩放' },
                { role: 'zoomIn', label: '放大' },
                { role: 'zoomOut', label: '缩小' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: '全屏' }
            ]
        },
        {
            label: '窗口',
            submenu: [
                { role: 'minimize', label: '最小化' },
                { role: 'zoom', label: '缩放' },
                { role: 'close', label: '关闭窗口' }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// 确保数据目录存在
function ensureDataDir() {
    const dir = path.dirname(dataPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// 简单加密函数（用于导出）
function encryptExport(text, key) {
    let result = '';
    for (let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return Buffer.from(result).toString('base64');
}

// 简单解密函数（用于导入）
function decryptImport(encrypted, key) {
    try {
        const text = Buffer.from(encrypted, 'base64').toString();
        let result = '';
        for (let i = 0; i < text.length; i++) {
            result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return result;
    } catch {
        return null;
    }
}

// IPC 处理
ipcMain.handle('get-tabs', async () => {
    try {
        ensureDataDir();
        if (fs.existsSync(dataPath)) {
            const data = fs.readFileSync(dataPath, 'utf-8');
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) {
                return { success: true, tabs: parsed, folders: [] };
            }
            return { success: true, tabs: parsed.tabs || [], folders: parsed.folders || [] };
        }
        return { success: true, tabs: [], folders: [] };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-tabs', async (event, data) => {
    try {
        ensureDataDir();
        const payload = { tabs: data.tabs || [], folders: data.folders || [] };
        fs.writeFileSync(dataPath, JSON.stringify(payload, null, 2), 'utf-8');
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 导出页签和凭据
ipcMain.handle('export-tabs', async (event, tabs) => {
    try {
        const result = await dialog.showSaveDialog(mainWindow, {
            title: '导出页签',
            defaultPath: 'tabs-export.json',
            filters: [{ name: 'JSON', extensions: ['json'] }]
        });

        if (!result.canceled && result.filePath) {
            // 获取所有凭据并解密
            const exportCredentials = [];
            if (fs.existsSync(credentialsPath)) {
                const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
                
                for (const key of Object.keys(credentials)) {
                    const cred = credentials[key];
                    try {
                        // 解密原密码
                        const encrypted = Buffer.from(cred.password, 'base64');
                        const plainPassword = safeStorage.decryptString(encrypted);
                        
                        // 用导出密钥重新加密
                        const exportedPassword = encryptExport(plainPassword, EXPORT_ENCRYPTION_KEY);
                        
                        exportCredentials.push({
                            url: cred.url,
                            username: cred.username,
                            password: exportedPassword,
                            updatedAt: cred.updatedAt
                        });
                    } catch (e) {
                        console.log('导出凭据失败:', e.message);
                    }
                }
            }

            const exportData = {
                version: '1.0',
                exportedAt: new Date().toISOString(),
                tabs: tabs,
                credentials: exportCredentials
            };

            fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8');
            return { success: true };
        }
        return { success: false, error: '取消导出' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 导入页签和凭据
ipcMain.handle('import-tabs', async () => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: '导入页签',
            filters: [{ name: 'JSON', extensions: ['json'] }],
            properties: ['openFile']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const data = fs.readFileSync(result.filePaths[0], 'utf-8');
            const importData = JSON.parse(data);
            
            // 导入凭据
            if (importData.credentials && Array.isArray(importData.credentials)) {
                ensureDataDir();
                
                let existingCredentials = {};
                if (fs.existsSync(credentialsPath)) {
                    existingCredentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
                }

                for (const cred of importData.credentials) {
                    // 解密导入的密码
                    const plainPassword = decryptImport(cred.password, EXPORT_ENCRYPTION_KEY);
                    
                    if (plainPassword) {
                        // 用系统钥匙串重新加密
                        const encrypted = safeStorage.encryptString(plainPassword);
                        const key = `${SERVICE_NAME}:${cred.url}:${cred.username}`;
                        
                        existingCredentials[key] = {
                            url: cred.url,
                            username: cred.username,
                            password: encrypted.toString('base64'),
                            updatedAt: cred.updatedAt || new Date().toISOString()
                        };
                    }
                }

                fs.writeFileSync(credentialsPath, JSON.stringify(existingCredentials, null, 2), 'utf-8');
            }

            return { success: true, tabs: importData.tabs || [] };
        }
        return { success: false, error: '取消导入' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 打开外部链接
ipcMain.handle('open-external', async (event, url) => {
    const { shell } = require('electron');
    await shell.openExternal(url);
    return { success: true };
});

// 获取共享 session 的 partition 名称（供 webview 使用）
ipcMain.handle('get-session-partition', () => {
    return SHARED_SESSION_NAME;
});

// 清除共享 session 的数据
ipcMain.handle('clear-session-data', async () => {
    try {
        const sharedSession = session.fromPartition(SHARED_SESSION_NAME);
        await sharedSession.clearStorageData();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 获取 cookies
ipcMain.handle('get-cookies', async () => {
    try {
        const sharedSession = session.fromPartition(SHARED_SESSION_NAME);
        const cookies = await sharedSession.cookies.get({});
        return { success: true, cookies };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============ 密码管理（使用系统钥匙串） ============

// 检查是否支持加密存储
ipcMain.handle('can-store-credentials', () => {
    return safeStorage.isEncryptionAvailable();
});

// 保存凭据到钥匙串
ipcMain.handle('save-credential', async (event, { url, username, password }) => {
    try {
        const key = `${SERVICE_NAME}:${url}:${username}`;
        const encrypted = safeStorage.encryptString(password);
        
        ensureDataDir();
        
        let credentials = {};
        if (fs.existsSync(credentialsPath)) {
            credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
        }
        
        credentials[key] = {
            url,
            username,
            password: encrypted.toString('base64'),
            updatedAt: new Date().toISOString()
        };
        
        fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), 'utf-8');
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 获取凭据
ipcMain.handle('get-credential', async (event, { url, username }) => {
    try {
        const key = `${SERVICE_NAME}:${url}:${username}`;
        
        if (!fs.existsSync(credentialsPath)) {
            return { success: false, error: '未找到凭据' };
        }
        
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
        const cred = credentials[key];
        
        if (!cred) {
            return { success: false, error: '未找到凭据' };
        }
        
        // 解密密码
        const encrypted = Buffer.from(cred.password, 'base64');
        const password = safeStorage.decryptString(encrypted);
        
        return { success: true, credential: { url, username, password } };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 获取某个URL的所有保存的用户名
ipcMain.handle('get-usernames-for-url', async (event, { url }) => {
    try {
        if (!fs.existsSync(credentialsPath)) {
            return { success: true, usernames: [] };
        }
        
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
        const usernames = [];
        
        for (const key of Object.keys(credentials)) {
            if (key.startsWith(`${SERVICE_NAME}:${url}:`)) {
                usernames.push(credentials[key].username);
            }
        }
        
        return { success: true, usernames };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 删除凭据
ipcMain.handle('delete-credential', async (event, { url, username }) => {
    try {
        const key = `${SERVICE_NAME}:${url}:${username}`;
        
        if (!fs.existsSync(credentialsPath)) {
            return { success: true };
        }
        
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
        delete credentials[key];
        
        fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), 'utf-8');
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 获取所有凭据列表（不含密码）
ipcMain.handle('list-credentials', async () => {
    try {
        if (!fs.existsSync(credentialsPath)) {
            return { success: true, credentials: [] };
        }
        
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
        const list = [];
        
        for (const key of Object.keys(credentials)) {
            const cred = credentials[key];
            list.push({
                url: cred.url,
                username: cred.username,
                updatedAt: cred.updatedAt
            });
        }
        
        return { success: true, credentials: list };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
