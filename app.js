class TabManager {
    constructor() {
        this.tabs = [];
        this.folders = [];
        this.activeTabId = null;
        this.activeFolderId = null;
        this.canStoreCredentials = false;
        this.sessionPartition = null;
        this.contextMenuTarget = null; // { type: 'tab'|'folder', id: string }
        this.pendingTab = null;
        this.webviews = new Map();
        this.draggedTabId = null;
        this.draggedFolderId = null;
        this.sidebarCollapsed = false;

        this.init();
    }

    async init() {
        this.sessionPartition = await window.tabAPI.getSessionPartition();
        this.canStoreCredentials = await window.tabAPI.canStoreCredentials();

        await this.loadTabs();
        this.bindEvents();
        this.renderTabList();

        if (this.tabs.length > 0) {
            this.selectTab(this.tabs[0].id);
        }
    }

    async loadTabs() {
        const result = await window.tabAPI.getTabs();
        if (result.success) {
            this.tabs = result.tabs || [];
            this.folders = result.folders || [];
        }
    }

    async saveTabs() {
        await window.tabAPI.saveTabs({ tabs: this.tabs, folders: this.folders });
    }

    createWebview(tabId, url) {
        const container = document.getElementById('webviewContainer');

        const wrapper = document.createElement('div');
        wrapper.className = 'webview-wrapper hidden';
        wrapper.id = `webview-wrapper-${tabId}`;

        const webview = document.createElement('webview');
        webview.allowpopups = true;
        if (this.sessionPartition) {
            webview.partition = this.sessionPartition;
        }

        const loading = document.createElement('div');
        loading.className = 'webview-loading hidden';
        loading.innerHTML = '<div class="spinner"></div><p>加载中...</p>';

        const error = document.createElement('div');
        error.className = 'webview-error hidden';
        error.innerHTML = '<span class="error-icon">⚠️</span><p>无法加载此页面</p><p class="error-detail"></p>';

        wrapper.appendChild(webview);
        wrapper.appendChild(loading);
        wrapper.appendChild(error);
        container.appendChild(wrapper);

        let loadTimer = null;

        function clearLoadTimer() {
            if (loadTimer) {
                clearTimeout(loadTimer);
                loadTimer = null;
            }
        }

        function logEvent(name, detail) {
            console.log(`[webview:${tabId}] ${name}`, detail || '');
        }

        webview.addEventListener('load-commit', (e) => logEvent('load-commit', { url: e.url, isMainFrame: e.isMainFrame }));
        webview.addEventListener('did-start-loading', () => {
            logEvent('did-start-loading');
            loading.classList.remove('hidden');
            error.classList.add('hidden');
            clearLoadTimer();
            loadTimer = setTimeout(() => {
                loading.classList.add('hidden');
                error.classList.remove('hidden');
                error.querySelector('.error-detail').textContent =
                    '页面加载超时，请检查网络或服务是否正常运行';
            }, 15000);
        });
        webview.addEventListener('did-stop-loading', () => {
            logEvent('did-stop-loading');
            clearLoadTimer();
            loading.classList.add('hidden');
        });
        webview.addEventListener('did-finish-load', async () => {
            logEvent('did-finish-load');
            clearLoadTimer();
            loading.classList.add('hidden');
            await this.tryAutoFill(tabId);
        });
        webview.addEventListener('did-fail-load', (event) => {
            logEvent('did-fail-load', { code: event.errorCode, desc: event.errorDescription, url: event.validatedURL });
            clearLoadTimer();
            loading.classList.add('hidden');
            error.classList.remove('hidden');
            error.querySelector('.error-detail').textContent =
                `错误代码: ${event.errorCode} - ${event.errorDescription}`;
        });
        webview.addEventListener('did-navigate', async (event) => {
            await this.tryAutoFill(tabId, event.url);
        });
        webview.addEventListener('did-navigate-in-page', async (event) => {
            await this.tryAutoFill(tabId, event.url);
        });

        this.webviews.set(tabId, { wrapper, webview, loading, error });

        webview.src = url || 'about:blank';

        return webview;
    }

    async tryAutoFill(tabId, currentUrl) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab || !tab.url) return;

        const url = currentUrl || tab.url;

        const result = await window.tabAPI.getUsernamesForUrl({ url: this.getBaseUrl(url) });
        if (!result.success || result.usernames.length === 0) return;

        const credResult = await window.tabAPI.getCredential({
            url: this.getBaseUrl(url),
            username: result.usernames[0]
        });

        if (!credResult.success) return;

        const { username, password } = credResult.credential;
        const webviewData = this.webviews.get(tabId);
        if (!webviewData) return;

        try {
            await webviewData.webview.executeJavaScript(`
                (function() {
                    const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[name*="user"], input[name*="email"], input[name*="login"], input[id*="user"], input[id*="email"], input[id*="login"]');
                    let userField = null;
                    let passField = document.querySelector('input[type="password"]');

                    for (const input of inputs) {
                        const name = (input.name || '').toLowerCase();
                        const id = (input.id || '').toLowerCase();
                        const type = input.type || '';

                        if (type === 'email' || name.includes('user') || name.includes('email') || name.includes('login') ||
                            id.includes('user') || id.includes('email') || id.includes('login')) {
                            userField = input;
                            break;
                        }
                    }

                    if (!userField && inputs.length > 0) userField = inputs[0];

                    if (userField) {
                        userField.value = "${username.replace(/"/g, '\\"')}";
                        userField.dispatchEvent(new Event('input', { bubbles: true }));
                        userField.dispatchEvent(new Event('change', { bubbles: true }));
                    }

                    if (passField) {
                        passField.value = "${password.replace(/"/g, '\\"')}";
                        passField.dispatchEvent(new Event('input', { bubbles: true }));
                        passField.dispatchEvent(new Event('change', { bubbles: true }));
                    }

                    return { filled: !!(userField || passField) };
                })();
            `);
        } catch (e) {
            console.log('自动填充失败:', e.message);
        }
    }

    getBaseUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.origin;
        } catch {
            return url;
        }
    }

    normalizeUrl(url) {
        if (!url) return '';
        url = url.trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return 'https://' + url;
        }
        return url;
    }

    generateId(prefix) {
        return (prefix || 'item') + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // ================= Folder methods =================

    showPrompt(title, defaultValue) {
        return new Promise(resolve => {
            const modal = document.getElementById('promptModal');
            const input = document.getElementById('promptInput');
            const titleEl = document.getElementById('promptTitle');
            titleEl.textContent = title;
            input.value = defaultValue || '';
            input.placeholder = '';
            modal.classList.remove('hidden');
            input.focus();
            input.select();

            const cleanup = () => {
                modal.classList.add('hidden');
                document.getElementById('promptOkBtn').removeEventListener('click', onOk);
                document.getElementById('promptCancelBtn').removeEventListener('click', onCancel);
                document.getElementById('promptCloseBtn').removeEventListener('click', onCancel);
                modal.querySelector('.modal-overlay').removeEventListener('click', onCancel);
                input.removeEventListener('keydown', onKeydown);
            };

            const onOk = () => {
                const val = input.value;
                cleanup();
                resolve(val);
            };
            const onCancel = () => {
                cleanup();
                resolve(null);
            };
            const onKeydown = (e) => {
                if (e.key === 'Enter') onOk();
                if (e.key === 'Escape') onCancel();
            };

            document.getElementById('promptOkBtn').addEventListener('click', onOk);
            document.getElementById('promptCancelBtn').addEventListener('click', onCancel);
            document.getElementById('promptCloseBtn').addEventListener('click', onCancel);
            modal.querySelector('.modal-overlay').addEventListener('click', onCancel);
            input.addEventListener('keydown', onKeydown);
        });
    }

    async createFolder() {
        const name = await this.showPrompt('请输入文件夹名称:');
        if (!name || !name.trim()) return;
        const folder = {
            id: this.generateId('folder'),
            name: name.trim(),
            expanded: true
        };
        this.folders.push(folder);
        await this.saveTabs();
        this.renderTabList();
    }

    async renameFolder(folderId) {
        const folder = this.folders.find(f => f.id === folderId);
        if (!folder) return;
        const name = await this.showPrompt('请输入新名称:', folder.name);
        if (!name || !name.trim()) return;
        folder.name = name.trim();
        await this.saveTabs();
        this.renderTabList();
    }

    async deleteFolder(folderId) {
        if (!confirm('确定要删除此文件夹及其所有页签吗？')) return;
        const folder = this.folders.find(f => f.id === folderId);
        if (!folder) return;

        this.folders = this.folders.filter(f => f.id !== folderId);
        this.tabs = this.tabs.filter(t => t.folderId !== folderId);

        this.webviews.forEach((data, tabId) => {
            const tab = this.tabs.find(t => t.id === tabId);
            if (!tab || !tab.folderId) {
                data.wrapper.remove();
                this.webviews.delete(tabId);
            }
        });

        await this.saveTabs();
        if (this.activeFolderId === folderId) this.activeFolderId = null;
        this.renderTabList();

        if (this.tabs.length > 0) {
            this.selectTab(this.tabs[0].id);
        } else {
            this.activeTabId = null;
            document.getElementById('emptyState').classList.remove('hidden');
        }
    }

    async toggleFolder(folderId) {
        const folder = this.folders.find(f => f.id === folderId);
        if (folder) {
            folder.expanded = !folder.expanded;
            await this.saveTabs();
            this.renderTabList();
        }
    }

    getFolderTabs(folderId) {
        return this.tabs.filter(t => t.folderId === folderId);
    }

    getRootTabs() {
        return this.tabs.filter(t => !t.folderId);
    }

    // ================= Sidebar methods =================

    toggleSidebar() {
        this.sidebarCollapsed = !this.sidebarCollapsed;
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('sidebarToggle');
        if (this.sidebarCollapsed) {
            sidebar.classList.add('collapsed');
            toggle.title = '展开侧边栏';
        } else {
            sidebar.classList.remove('collapsed');
            toggle.title = '收起侧边栏';
        }
    }

    // ================= Tab methods =================

    selectTab(tabId) {
        this.activeTabId = tabId;
        const tab = this.tabs.find(t => t.id === tabId);

        if (!tab) return;

        document.getElementById('emptyState').classList.add('hidden');

        document.querySelectorAll('.tab-item').forEach(el => {
            el.classList.toggle('active', el.dataset.tabId === tabId);
        });

        this.webviews.forEach((data, id) => {
            data.wrapper.classList.add('hidden');
        });

        let webviewData = this.webviews.get(tabId);
        if (!webviewData && tab.url) {
            this.createWebview(tabId, this.normalizeUrl(tab.url));
            webviewData = this.webviews.get(tabId);
        }

        if (webviewData) {
            webviewData.wrapper.classList.remove('hidden');
        }
    }

    refreshTab(tabId) {
        const webviewData = this.webviews.get(tabId);
        if (webviewData) {
            webviewData.webview.reload();
        }
    }

    createTab(folderId) {
        this.pendingTab = {
            id: this.generateId('tab'),
            name: '',
            url: '',
            folderId: folderId || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.openEditModalForNew();
    }

    openEditModalForNew() {
        document.getElementById('tabNameInput').value = '';
        document.getElementById('urlInput').value = '';
        document.getElementById('remarkInput').value = '';
        document.getElementById('saveCredentialCheck').checked = false;
        document.getElementById('credentialInputs').classList.add('hidden');
        document.getElementById('usernameInput').value = '';
        document.getElementById('passwordInput').value = '';
        document.getElementById('editModal').classList.remove('hidden');
        document.getElementById('tabNameInput').focus();
    }

    async openEditModal() {
        if (!this.activeTabId) return;

        const tab = this.tabs.find(t => t.id === this.activeTabId);
        if (!tab) return;

        this.pendingTab = null;

        document.getElementById('tabNameInput').value = tab.name;
        document.getElementById('urlInput').value = tab.url || '';
        document.getElementById('remarkInput').value = tab.remark || '';
        document.getElementById('saveCredentialCheck').checked = false;
        document.getElementById('credentialInputs').classList.add('hidden');
        document.getElementById('usernameInput').value = '';
        document.getElementById('passwordInput').value = '';

        if (tab.url && this.canStoreCredentials) {
            const result = await window.tabAPI.getUsernamesForUrl({ url: this.getBaseUrl(tab.url) });
            if (result.success && result.usernames.length > 0) {
                document.getElementById('saveCredentialCheck').checked = true;
                document.getElementById('credentialInputs').classList.remove('hidden');
                document.getElementById('usernameInput').value = result.usernames[0];
            }
        }

        document.getElementById('editModal').classList.remove('hidden');
        document.getElementById('tabNameInput').focus();
    }

    cancelEdit() {
        if (this.pendingTab) {
            this.pendingTab = null;
        }
        document.getElementById('editModal').classList.add('hidden');
    }

    async saveCurrentTab() {
        const name = document.getElementById('tabNameInput').value.trim() || '未命名';
        const url = document.getElementById('urlInput').value.trim();
        const remark = document.getElementById('remarkInput').value.trim();

        if (this.pendingTab) {
            this.pendingTab.name = name;
            this.pendingTab.url = url;
            this.pendingTab.remark = remark;
            this.pendingTab.updatedAt = new Date().toISOString();

            if (url && document.getElementById('saveCredentialCheck').checked) {
                const username = document.getElementById('usernameInput').value.trim();
                const password = document.getElementById('passwordInput').value;
                if (username && password) {
                    await window.tabAPI.saveCredential({
                        url: this.getBaseUrl(this.normalizeUrl(url)),
                        username,
                        password
                    });
                }
            }

            this.tabs.unshift(this.pendingTab);
            await this.saveTabs();
            this.renderTabList();
            this.selectTab(this.pendingTab.id);
            this.pendingTab = null;
        } else {
            if (!this.activeTabId) return;

            const tab = this.tabs.find(t => t.id === this.activeTabId);
            if (!tab) return;

            const oldUrl = tab.url;
            tab.name = name;
            tab.url = url;
            tab.remark = remark;
            tab.updatedAt = new Date().toISOString();

            if (url && document.getElementById('saveCredentialCheck').checked) {
                const username = document.getElementById('usernameInput').value.trim();
                const password = document.getElementById('passwordInput').value;
                if (username && password) {
                    await window.tabAPI.saveCredential({
                        url: this.getBaseUrl(this.normalizeUrl(url)),
                        username,
                        password
                    });
                }
            }

            await this.saveTabs();
            this.renderTabList();

            if (oldUrl !== url) {
                const oldWebview = this.webviews.get(this.activeTabId);
                if (oldWebview) {
                    oldWebview.wrapper.remove();
                    this.webviews.delete(this.activeTabId);
                }
                this.selectTab(this.activeTabId);
            }
        }

        document.getElementById('editModal').classList.add('hidden');
        this.showToast('保存成功');
    }

    async deleteTab(tabId) {
        if (!confirm('确定要删除此页签吗？')) return;

        const index = this.tabs.findIndex(t => t.id === tabId);
        if (index > -1) {
            const webviewData = this.webviews.get(tabId);
            if (webviewData) {
                webviewData.wrapper.remove();
                this.webviews.delete(tabId);
            }

            this.tabs.splice(index, 1);
            await this.saveTabs();
            this.renderTabList();
            document.getElementById('editModal').classList.add('hidden');

            if (this.activeTabId === tabId) {
                if (this.tabs.length > 0) {
                    const nextIndex = Math.min(index, this.tabs.length - 1);
                    this.selectTab(this.tabs[nextIndex].id);
                } else {
                    this.activeTabId = null;
                    document.getElementById('emptyState').classList.remove('hidden');
                }
            }
        }
    }

    async deleteCurrentTab() {
        if (!this.activeTabId) return;
        await this.deleteTab(this.activeTabId);
    }

    async moveTabToFolder(tabId, folderId) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (tab) {
            tab.folderId = folderId || null;
            await this.saveTabs();
            this.renderTabList();
        }
    }

    // ================= Drag and Drop =================

    handleDragStart(e, tabId) {
        this.draggedTabId = tabId;
        this.draggedFolderId = null;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tabId);

        const tabElement = e.target.closest('.tab-item');
        if (tabElement) {
            tabElement.classList.add('dragging');
        }
    }

    handleFolderDragStart(e, folderId) {
        this.draggedFolderId = folderId;
        this.draggedTabId = null;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', folderId);
    }

    handleDragOver(e, targetId, targetType) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        document.querySelectorAll('.tab-item, .folder-item').forEach(el => {
            el.classList.remove('drag-over', 'drag-over-bottom');
        });

        const selector = targetType === 'folder' ? '.folder-item' : '.tab-item';
        const el = e.target.closest(selector);
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;

        if (e.clientY < midpoint) {
            el.classList.add('drag-over');
        } else {
            el.classList.add('drag-over-bottom');
        }
    }

    handleDragLeave(e) {
        const el = e.target.closest('.tab-item, .folder-item');
        if (el) {
            el.classList.remove('drag-over', 'drag-over-bottom');
        }
    }

    async handleDrop(e, targetId, targetType) {
        e.preventDefault();

        if (this.draggedTabId) {
            if (targetType === 'folder') {
                await this.moveTabToFolder(this.draggedTabId, targetId);
            } else if (targetType === 'tab') {
                const targetTab = this.tabs.find(t => t.id === targetId);
                if (!targetTab) return;

                const draggedIndex = this.tabs.findIndex(t => t.id === this.draggedTabId);
                const targetIndex = this.tabs.findIndex(t => t.id === targetId);
                if (draggedIndex === -1 || targetIndex === -1) return;

                const [draggedTab] = this.tabs.splice(draggedIndex, 1);

                const el = e.target.closest('.tab-item');
                const rect = el ? el.getBoundingClientRect() : null;
                const insertAfter = rect ? e.clientY >= rect.top + rect.height / 2 : false;

                let newIndex = targetIndex;
                if (draggedIndex < targetIndex) {
                    newIndex = insertAfter ? targetIndex : targetIndex - 1;
                } else {
                    newIndex = insertAfter ? targetIndex + 1 : targetIndex;
                }

                this.tabs.splice(newIndex, 0, draggedTab);
                await this.saveTabs();
                this.renderTabList();
            }
        } else if (this.draggedFolderId) {
            if (targetType === 'folder' && targetId !== this.draggedFolderId) {
                const draggedIdx = this.folders.findIndex(f => f.id === this.draggedFolderId);
                const targetIdx = this.folders.findIndex(f => f.id === targetId);
                if (draggedIdx === -1 || targetIdx === -1) return;

                const [draggedFolder] = this.folders.splice(draggedIdx, 1);
                const el = e.target.closest('.folder-item');
                const rect = el ? el.getBoundingClientRect() : null;
                const insertAfter = rect ? e.clientY >= rect.top + rect.height / 2 : false;

                let newIndex = targetIdx;
                if (draggedIdx < targetIdx) {
                    newIndex = insertAfter ? targetIdx : targetIdx - 1;
                } else {
                    newIndex = insertAfter ? targetIdx + 1 : targetIdx;
                }

                this.folders.splice(newIndex, 0, draggedFolder);
                await this.saveTabs();
                this.renderTabList();
            }
        }

        document.querySelectorAll('.tab-item, .folder-item').forEach(el => {
            el.classList.remove('dragging', 'drag-over', 'drag-over-bottom');
        });
        this.draggedTabId = null;
        this.draggedFolderId = null;
    }

    handleDragEnd(e) {
        this.draggedTabId = null;
        this.draggedFolderId = null;
        document.querySelectorAll('.tab-item, .folder-item').forEach(el => {
            el.classList.remove('dragging', 'drag-over', 'drag-over-bottom');
        });
    }

    // ================= Context Menu =================

    bindContextMenuEvents() {
        const contextMenu = document.getElementById('contextMenu');

        contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                this.handleContextMenuAction(item.dataset.action);
                this.hideContextMenu();
            });
        });

        document.addEventListener('click', (e) => {
            if (!contextMenu.contains(e.target)) {
                this.hideContextMenu();
            }
        });
    }

    handleContextMenuAction(action) {
        if (!this.contextMenuTarget) return;
        const { type, id } = this.contextMenuTarget;

        if (type === 'tab') {
            if (action === 'edit') {
                this.activeTabId = id;
                this.selectTab(id);
                this.openEditModal();
            } else if (action === 'delete') {
                this.deleteTab(id);
            }
        } else if (type === 'folder') {
            if (action === 'rename-folder') {
                this.renameFolder(id);
            } else if (action === 'delete-folder') {
                this.deleteFolder(id);
            } else if (action === 'add-tab-to-folder') {
                this.createTab(id);
            }
        }
    }

    showContextMenu(x, y, target) {
        const contextMenu = document.getElementById('contextMenu');
        this.contextMenuTarget = target;

        contextMenu.querySelectorAll('.context-menu-item').forEach(el => {
            const action = el.dataset.action;
            if (target.type === 'folder') {
                el.style.display = (action === 'rename-folder' || action === 'delete-folder' || action === 'add-tab-to-folder') ? '' : 'none';
                if (action === 'rename-folder') el.querySelector('.menu-text').textContent = '重命名文件夹';
                if (action === 'delete-folder') el.querySelector('.menu-text').textContent = '删除文件夹';
                if (action === 'add-tab-to-folder') el.querySelector('.menu-text').textContent = '新建页签到此文件夹';
            } else {
                el.style.display = (action === 'edit' || action === 'delete') ? '' : 'none';
                if (action === 'edit') el.querySelector('.menu-text').textContent = '编辑';
                if (action === 'delete') el.querySelector('.menu-text').textContent = '删除';
            }
        });

        contextMenu.style.left = `${x}px`;
        contextMenu.style.top = `${y}px`;
        contextMenu.classList.remove('hidden');

        const rect = contextMenu.getBoundingClientRect();
        if (x > window.innerWidth - rect.width) contextMenu.style.left = `${window.innerWidth - rect.width}px`;
        if (y > window.innerHeight - rect.height) contextMenu.style.top = `${window.innerHeight - rect.height}px`;
    }

    hideContextMenu() {
        document.getElementById('contextMenu').classList.add('hidden');
        this.contextMenuTarget = null;
    }

    // ================= Rendering =================

    renderTabList(filter = '') {
        const tabList = document.getElementById('tabList');
        tabList.innerHTML = '';

        const filteredTabs = filter
            ? this.tabs.filter(t => t.name.toLowerCase().includes(filter.toLowerCase()))
            : this.tabs;

        const rootTabs = filter
            ? filteredTabs.filter(t => !t.folderId)
            : this.getRootTabs();

        const folders = filter
            ? this.folders.filter(f => filteredTabs.some(t => t.folderId === f.id))
            : [...this.folders];

        const renderedTabIds = new Set();

        function makeTabHtml(tab, isChild) {
            renderedTabIds.add(tab.id);
            return `
                <div class="tab-item ${isChild ? 'tab-item-child' : ''} ${tab.id === this.activeTabId ? 'active' : ''}"
                     data-tab-id="${tab.id}" draggable="true">
                    <span class="tab-title">${this.escapeHtml(tab.name)}</span>
                    ${tab.remark ? `<span class="tab-remark">${this.escapeHtml(tab.remark)}</span>` : ''}
                    <button class="tab-refresh-btn" data-tab-id="${tab.id}" title="刷新">🔄</button>
                </div>
            `;
        }

        const fragment = document.createDocumentFragment();
        const tempDiv = document.createElement('div');

        rootTabs.forEach(tab => {
            tempDiv.innerHTML = makeTabHtml.call(this, tab, false);
            fragment.appendChild(tempDiv.firstElementChild);
        });

        folders.forEach(folder => {
            const folderTabs = this.getFolderTabs(folder.id);
            const folderEl = document.createElement('div');
            folderEl.className = 'folder-item';
            folderEl.dataset.folderId = folder.id;
            const headerEl = document.createElement('div');
            headerEl.className = 'folder-header';
            headerEl.dataset.folderId = folder.id;

            const chevron = document.createElement('span');
            chevron.className = 'folder-chevron';
            chevron.textContent = folder.expanded ? '▼' : '▶';

            const icon = document.createElement('span');
            icon.className = 'folder-icon';
            icon.textContent = '📁';

            const nameEl = document.createElement('span');
            nameEl.className = 'folder-name';
            nameEl.textContent = folder.name;

            const countEl = document.createElement('span');
            countEl.className = 'folder-count';
            countEl.textContent = folderTabs.length;

            const addBtn = document.createElement('button');
            addBtn.className = 'folder-add-btn';
            addBtn.dataset.folderId = folder.id;
            addBtn.title = '在此文件夹新建页签';
            addBtn.textContent = '➕';
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.createTab(folder.id);
            });

            headerEl.appendChild(chevron);
            headerEl.appendChild(icon);
            headerEl.appendChild(nameEl);
            headerEl.appendChild(countEl);
            headerEl.appendChild(addBtn);

            headerEl.addEventListener('click', (e) => {
                if (e.target.closest('.folder-add-btn')) return;
                this.toggleFolder(folder.id);
            });

            headerEl.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showContextMenu(e.clientX, e.clientY, { type: 'folder', id: folder.id });
            });

            folderEl.addEventListener('dragover', (e) => this.handleDragOver(e, folder.id, 'folder'));
            folderEl.addEventListener('dragleave', (e) => this.handleDragLeave(e));
            folderEl.addEventListener('drop', (e) => this.handleDrop(e, folder.id, 'folder'));

            const childrenEl = document.createElement('div');
            childrenEl.className = 'folder-children' + (folder.expanded ? '' : ' hidden');
            folderTabs.forEach(tab => {
                const temp = document.createElement('div');
                temp.innerHTML = makeTabHtml.call(this, tab, true);
                childrenEl.appendChild(temp.firstElementChild);
            });

            folderEl.appendChild(headerEl);
            folderEl.appendChild(childrenEl);
            fragment.appendChild(folderEl);
        });

        tabList.appendChild(fragment);

        // Bind tab events
        tabList.querySelectorAll('.tab-item').forEach(el => {
            const tabId = el.dataset.tabId;

            el.addEventListener('click', (e) => {
                if (e.target.classList.contains('tab-refresh-btn')) return;
                this.selectTab(tabId);
            });

            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showContextMenu(e.clientX, e.clientY, { type: 'tab', id: tabId });
            });

            el.addEventListener('dragstart', (e) => this.handleDragStart(e, tabId));
            el.addEventListener('dragover', (e) => this.handleDragOver(e, tabId, 'tab'));
            el.addEventListener('dragleave', (e) => this.handleDragLeave(e));
            el.addEventListener('drop', (e) => this.handleDrop(e, tabId, 'tab'));
            el.addEventListener('dragend', (e) => this.handleDragEnd(e));
        });

        // Bind refresh buttons
        tabList.querySelectorAll('.tab-refresh-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.refreshTab(btn.dataset.tabId);
            });
        });

        // Folder events are bound directly during element creation above
    }

    filterTabs(keyword) {
        this.renderTabList(keyword);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showToast(message) {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background-color: var(--success-color);
            color: var(--bg-darker);
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            z-index: 2000;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

    // ================= Event Binding =================

    bindEvents() {
        document.getElementById('sidebarToggle').addEventListener('click', () => this.toggleSidebar());
        document.getElementById('addTabBtn').addEventListener('click', () => this.createTab());
        document.getElementById('addFolderBtn').addEventListener('click', () => this.createFolder());

        document.getElementById('closeModalBtn').addEventListener('click', () => this.cancelEdit());
        document.getElementById('cancelModalBtn').addEventListener('click', () => this.cancelEdit());
        document.querySelector('.modal-overlay').addEventListener('click', () => this.cancelEdit());
        document.getElementById('saveTabBtn').addEventListener('click', () => this.saveCurrentTab());
        document.getElementById('deleteTabBtn').addEventListener('click', () => this.deleteCurrentTab());

        document.getElementById('saveCredentialCheck').addEventListener('change', (e) => {
            document.getElementById('credentialInputs').classList.toggle('hidden', !e.target.checked);
        });

        document.getElementById('importBtn').addEventListener('click', async () => {
            const result = await window.tabAPI.importTabs();
            if (result.success && result.tabs) {
                const existingIds = new Set(this.tabs.map(t => t.id));
                const newTabs = result.tabs.filter(t => !existingIds.has(t.id));
                this.tabs = [...this.tabs, ...newTabs];
                await this.saveTabs();
                this.renderTabList();
                this.showToast(`成功导入 ${newTabs.length} 个页签`);
            }
        });

        document.getElementById('exportBtn').addEventListener('click', async () => {
            if (this.tabs.length === 0) {
                this.showToast('没有可导出的页签');
                return;
            }
            const result = await window.tabAPI.exportTabs(this.tabs);
            if (result.success) this.showToast('导出成功');
        });

        document.getElementById('searchInput').addEventListener('input', (e) => this.filterTabs(e.target.value));

        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (!document.getElementById('editModal').classList.contains('hidden')) {
                    this.saveCurrentTab();
                }
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
                e.preventDefault();
                this.createTab();
            }
            if (e.key === 'Escape') {
                this.cancelEdit();
                this.hideContextMenu();
            }
        });

        this.bindContextMenuEvents();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new TabManager();
});