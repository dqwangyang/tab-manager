const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tabAPI', {
    // 页签管理
    getTabs: () => ipcRenderer.invoke('get-tabs'),
    saveTabs: (tabs) => ipcRenderer.invoke('save-tabs', tabs),
    exportTabs: (tabs) => ipcRenderer.invoke('export-tabs', tabs),
    importTabs: () => ipcRenderer.invoke('import-tabs'),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    
    // Session 管理
    getSessionPartition: () => ipcRenderer.invoke('get-session-partition'),
    clearSessionData: () => ipcRenderer.invoke('clear-session-data'),
    getCookies: () => ipcRenderer.invoke('get-cookies'),
    
    // 密码管理
    canStoreCredentials: () => ipcRenderer.invoke('can-store-credentials'),
    saveCredential: (data) => ipcRenderer.invoke('save-credential', data),
    getCredential: (data) => ipcRenderer.invoke('get-credential', data),
    getUsernamesForUrl: (data) => ipcRenderer.invoke('get-usernames-for-url', data),
    deleteCredential: (data) => ipcRenderer.invoke('delete-credential', data),
    listCredentials: () => ipcRenderer.invoke('list-credentials')
});
