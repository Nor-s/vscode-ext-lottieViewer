import * as vscode from 'vscode';
import * as path from 'path';

export class ThorVGViewerPanel {
    public static currentPanel: ThorVGViewerPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _autoSyncEnabled: boolean = false;
    private _currentDocument: vscode.TextDocument | undefined;
    private _currentResourceUri: vscode.Uri | undefined;
    private _webviewReady: Promise<void>;
    private _webviewReadyResolver: (() => void) | undefined;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, autoSync: boolean = true) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._autoSyncEnabled = autoSync;
        this._webviewReady = new Promise(resolve => {
            this._webviewReadyResolver = resolve;
        });

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Set up auto-sync listeners
        this._setupAutoSync();

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'alert': {
                        vscode.window.showInformationMessage(message.text);
                        return;
                    }
                    case 'log': {
                        console.log('ThorVG Viewer log:', message.text);
                        return;
                    }
                    case 'loadError': {
                        // File loading failed in the webview
                        // Show error to user but DON'T change current document state
                        vscode.window.showErrorMessage(`ThorVG Viewer: ${message.text}`);
                        console.error('ThorVG Viewer load error:', message.text);
                        return;
                    }
                    case 'pickFile': {
                        // Show VSCode file picker
                        const fileUris = await vscode.window.showOpenDialog({
                            canSelectMany: true,
                            openLabel: 'Select File',
                            filters: {
                                'Vector Graphics': ['svg', 'json', 'lot', 'png'],
                                'All Files': ['*']
                            }
                        });

                        if (fileUris && fileUris.length > 0) {
                            // Read each file and send to webview
                            for (const fileUri of fileUris) {
                                const fileName = fileUri.fsPath.split(/[\\/]/).pop() || 'unknown';
                                const fileData = await vscode.workspace.fs.readFile(fileUri);

                                // Determine if file is text or binary
                                const ext = fileName.split('.').pop()?.toLowerCase();
                                let fileContent: string;

                                if (ext === 'json' || ext === 'lot' || ext === 'svg') {
                                    // Text file - decode as UTF-8
                                    fileContent = new TextDecoder().decode(fileData);
                                } else if (ext === 'png') {
                                    // PNG file - convert to base64 data URL
                                    const base64 = Buffer.from(fileData).toString('base64');
                                    fileContent = `data:image/png;base64,${base64}`;
                                } else {
                                    // Other binary file
                                    const base64 = Buffer.from(fileData).toString('base64');
                                    fileContent = `data:application/octet-stream;base64,${base64}`;
                                }

                                // Send file to webview
                                await this._ensureWebviewReady();
                                this._panel.webview.postMessage({
                                    command: 'loadFile',
                                    fileName: fileName,
                                    fileData: fileContent
                                });
                            }
                        }
                        return;
                    }
                    case 'exportFile': {
                        // Handle file export (PNG/GIF)
                        const defaultFileName = message.fileName || `export.${message.fileType}`;
                        const fileTypeUpper = message.fileType.toUpperCase();

                        const baseFolderUri = this._currentDocument
                            ? vscode.Uri.file(path.dirname(this._currentDocument.uri.fsPath))
                            : vscode.workspace.workspaceFolders?.[0]?.uri;
                        const defaultUri = baseFolderUri
                            ? vscode.Uri.joinPath(baseFolderUri, defaultFileName)
                            : vscode.Uri.file(defaultFileName);

                        const saveUri = await vscode.window.showSaveDialog({
                            defaultUri,
                            filters: {
                                [fileTypeUpper]: [message.fileType]
                            }
                        });

                        if (saveUri) {
                            try {
                                // Convert data URL or base64 to buffer
                                let buffer: Buffer;
                                const fileData = message.fileData;

                                if (typeof fileData === 'string') {
                                    // Handle data URL format (data:image/png;base64,...)
                                    if (fileData.startsWith('data:')) {
                                        const base64Data = fileData.split(',')[1];
                                        buffer = Buffer.from(base64Data, 'base64');
                                    } else {
                                        // Already base64
                                        buffer = Buffer.from(fileData, 'base64');
                                    }
                                } else if (fileData instanceof Uint8Array) {
                                    buffer = Buffer.from(fileData);
                                } else {
                                    throw new Error('Unsupported file data format');
                                }

                                // Write file
                                await vscode.workspace.fs.writeFile(saveUri, buffer);
                                vscode.window.showInformationMessage(`${fileTypeUpper} exported successfully: ${saveUri.fsPath}`);
                            } catch (error) {
                                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                                vscode.window.showErrorMessage(`Failed to export ${fileTypeUpper}: ${errorMsg}`);
                            }
                        }
                        return;
                    }
                    case 'showError': {
                        vscode.window.showErrorMessage(message.text);
                        return;
                    }
                    case 'ready': {
                        if (this._webviewReadyResolver) {
                            this._webviewReadyResolver();
                            this._webviewReadyResolver = undefined;
                        }
                        return;
                    }
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (ThorVGViewerPanel.currentPanel) {
            ThorVGViewerPanel.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'thorvgViewer',
            'ThorVG Viewer',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'thorvg-viewer'),
                    vscode.Uri.joinPath(extensionUri, 'thorvg-viewer', 'icon')
                ]
            }
        );

        ThorVGViewerPanel.currentPanel = new ThorVGViewerPanel(panel, extensionUri);
    }

    public static async createOrShowWithCurrentFile(extensionUri: vscode.Uri, resourceUri?: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it and load current file
        if (ThorVGViewerPanel.currentPanel) {
            ThorVGViewerPanel.currentPanel._panel.reveal(column);
            await ThorVGViewerPanel.currentPanel._loadCurrentFile(resourceUri);
            return;
        }

        // Otherwise, create a new panel with auto-sync enabled
        const panel = vscode.window.createWebviewPanel(
            'thorvgViewer',
            'ThorVG Viewer',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'thorvg-viewer'),
                    vscode.Uri.joinPath(extensionUri, 'thorvg-viewer', 'icon')
                ]
            }
        );

        ThorVGViewerPanel.currentPanel = new ThorVGViewerPanel(panel, extensionUri, true);

        // Load the current file after panel is ready
        await ThorVGViewerPanel.currentPanel._loadCurrentFile(resourceUri);
    }

    private _setupAutoSync() {
        // Listen for document changes
        const documentChangeListener = vscode.workspace.onDidChangeTextDocument(async e => {
            if (this._autoSyncEnabled && this._currentDocument && e.document === this._currentDocument) {
                // Reload the file when it changes
                await this._loadDocument(this._currentDocument);
            }
        });
        this._disposables.push(documentChangeListener);

        // Listen for active editor changes
        const editorChangeListener = vscode.window.onDidChangeActiveTextEditor(async editor => {
            if (this._autoSyncEnabled && editor && this._isSupportedFile(editor.document)) {
                await this._loadDocument(editor.document);
                return;
            }
            if (this._autoSyncEnabled) {
                await this._syncActiveResourceIfSupported();
            }
        });
        this._disposables.push(editorChangeListener);

        // Listen for tab changes (covers image/custom viewers where no text editor exists)
        const tabChangeListener = vscode.window.tabGroups.onDidChangeTabs(async () => {
            if (this._autoSyncEnabled) {
                await this._syncActiveResourceIfSupported();
            }
        });
        this._disposables.push(tabChangeListener);

        // Listen for active tab group changes (captures focus shifts between custom editors)
        const tabGroupChangeListener = vscode.window.tabGroups.onDidChangeTabGroups(async () => {
            if (this._autoSyncEnabled) {
                await this._syncActiveResourceIfSupported();
            }
        });
        this._disposables.push(tabGroupChangeListener);

        // Initial sync for whatever is currently active
        this._syncActiveResourceIfSupported();
    }

    private async _loadCurrentFile(resourceUri?: vscode.Uri, silentIfMissing: boolean = false) {
        const targetUri = resourceUri ?? this._getActiveResourceUri();

        if (!targetUri) {
            if (!silentIfMissing) {
                vscode.window.showWarningMessage('No active file found. Please open a file (.svg, .json, .lot, .png)');
            }
            return;
        }

        if (!this._isSupportedPath(targetUri.fsPath)) {
            if (!silentIfMissing) {
                vscode.window.showWarningMessage('Selected file is not a supported format (.svg, .json, .lot, .png)');
            }
            return;
        }

        const activeDoc = vscode.window.activeTextEditor?.document;
        if (activeDoc && activeDoc.uri.toString() === targetUri.toString()) {
            if (!this._isSupportedFile(activeDoc)) {
                if (!silentIfMissing) {
                    vscode.window.showWarningMessage('Current file is not a supported format (.svg, .json, .lot, .png)');
                }
                return;
            }
            await this._loadDocument(activeDoc);
            return;
        }

        await this._loadUri(targetUri);
    }

    private _getActiveResourceUri(): vscode.Uri | undefined {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && this._isSupportedPath(activeEditor.document.uri.fsPath)) {
            return activeEditor.document.uri;
        }

        const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
        const fromActiveTab = this._getUriFromTabInput(activeTab?.input);
        if (fromActiveTab && this._isSupportedPath(fromActiveTab.fsPath)) {
            return fromActiveTab;
        }

        // Fallback: scan all tabs for the first supported URI
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                const uri = this._getUriFromTabInput(tab.input);
                if (uri && this._isSupportedPath(uri.fsPath)) {
                    return uri;
                }
            }
        }

        return undefined;
    }

    private _getUriFromTabInput(input: any): vscode.Uri | undefined {
        if (!input) {
            return undefined;
        }
        if ('uri' in input && (input as { uri?: vscode.Uri }).uri) {
            return (input as { uri: vscode.Uri }).uri;
        }
        if ('modified' in input && (input as { modified?: vscode.Uri }).modified) {
            return (input as { modified: vscode.Uri }).modified;
        }
        if ('original' in input && (input as { original?: vscode.Uri }).original) {
            return (input as { original: vscode.Uri }).original;
        }
        if ('notebookUri' in input && (input as { notebookUri?: vscode.Uri }).notebookUri) {
            return (input as { notebookUri: vscode.Uri }).notebookUri;
        }

        return undefined;
    }

    private _isSupportedPath(filePath: string): boolean {
        const lowerPath = filePath.toLowerCase();
        return lowerPath.endsWith('.svg') ||
               lowerPath.endsWith('.json') ||
               lowerPath.endsWith('.lot') ||
               lowerPath.endsWith('.png');
    }

    private _isSupportedFile(document: vscode.TextDocument): boolean {
        return this._isSupportedPath(document.fileName);
    }

    private async _loadUri(uri: vscode.Uri) {
        const fileName = path.basename(uri.fsPath);
        const ext = fileName.split('.').pop()?.toLowerCase();

        if (ext === 'json' || ext === 'lot' || ext === 'svg') {
            const document = await vscode.workspace.openTextDocument(uri);
            await this._loadDocument(document);
            return;
        }

        // Binary types: read directly and avoid setting _currentDocument for auto-sync
        const fileData = await vscode.workspace.fs.readFile(uri);
        let fileContent: string;
        if (ext === 'png') {
            const base64 = Buffer.from(fileData).toString('base64');
            fileContent = `data:image/png;base64,${base64}`;
        } else {
            const base64 = Buffer.from(fileData).toString('base64');
            fileContent = `data:application/octet-stream;base64,${base64}`;
        }

        this._currentDocument = undefined;
        this._currentResourceUri = uri;

        await this._ensureWebviewReady();
        this._panel.webview.postMessage({
            command: 'loadFile',
            fileName,
            fileData: fileContent
        });
    }

    private async _loadDocument(document: vscode.TextDocument) {
        this._currentDocument = document;
        this._currentResourceUri = document.uri;

        const fileName = document.fileName.split(/[\\/]/).pop() || 'unknown';
        const ext = fileName.split('.').pop()?.toLowerCase();
        let fileContent: string;

        if (ext === 'json' || ext === 'lot' || ext === 'svg') {
            // Use in-memory text to include unsaved changes
            fileContent = document.getText();
        } else if (ext === 'png') {
            // Read and encode binary as data URL for webview consumption
            const fileData = await vscode.workspace.fs.readFile(document.uri);
            const base64 = Buffer.from(fileData).toString('base64');
            fileContent = `data:image/png;base64,${base64}`;
        } else {
            // Fallback for other binary formats
            const fileData = await vscode.workspace.fs.readFile(document.uri);
            const base64 = Buffer.from(fileData).toString('base64');
            fileContent = `data:application/octet-stream;base64,${base64}`;
        }

        // Send file to webview
        await this._ensureWebviewReady();
        this._panel.webview.postMessage({
            command: 'loadFile',
            fileName: fileName,
            fileData: fileContent
        });
    }

    private async _ensureWebviewReady() {
        await this._webviewReady;
    }

    private _urisEqual(a: vscode.Uri, b: vscode.Uri): boolean {
        return a.toString() === b.toString();
    }

    private async _syncActiveResourceIfSupported() {
        // First check if active editor/tab is a supported file
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && this._isSupportedPath(activeEditor.document.uri.fsPath)) {
            // Active editor is supported, sync to it
            if (this._currentResourceUri && this._urisEqual(this._currentResourceUri, activeEditor.document.uri)) {
                return; // Already showing this file
            }
            await this._loadCurrentFile(activeEditor.document.uri, true);
            return;
        }

        const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
        const fromActiveTab = this._getUriFromTabInput(activeTab?.input);
        if (fromActiveTab && this._isSupportedPath(fromActiveTab.fsPath)) {
            // Active tab is supported, sync to it
            if (this._currentResourceUri && this._urisEqual(this._currentResourceUri, fromActiveTab)) {
                return; // Already showing this file
            }
            await this._loadCurrentFile(fromActiveTab, true);
        }

        // Active editor/tab is NOT a supported file
        // Keep current file displayed - don't switch to another file
        // This prevents the viewer from jumping to the first file in the list
    }

    public dispose() {
        ThorVGViewerPanel.currentPanel = undefined;

        // Clean up resources
        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Get resource URIs for ThorVG Viewer assets (from thorvg-viewer submodule)
        const lottiePlayerUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'thorvg-viewer', 'lottie-player.js')
        );
        const mainJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'thorvg-viewer', 'main.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'thorvg-viewer', 'style.css')
        );
        const faviconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'thorvg-viewer', 'favicon.svg')
        );

        // Icon URIs (from thorvg-viewer submodule)
        const statsIconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'thorvg-viewer', 'icon', 'stats.svg')
        );
        const darkIconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'thorvg-viewer', 'icon', 'dark.svg')
        );
        const historyIconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'thorvg-viewer', 'icon', 'history.svg')
        );
        const closeIconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'thorvg-viewer', 'icon', 'close.svg')
        );

        // WASM file URI (from thorvg-viewer submodule)
        const wasmUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'thorvg-viewer', 'thorvg.wasm')
        );

        // Custom files from media directory
        const bridgeJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode-bridge.js')
        );

        // Stats.js URI (from media directory)
        const statsJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'stats.min.js')
        );

        // Override CSS for fixing z-index issues
        const overrideCssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'thorvg-viewer-override.css')
        );

        // Return the full HTML content with CSP that allows external fonts
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8" />
    <title>ThorVG Viewer | Thor Vector Graphics</title>
    <meta name="description" content="ThorVG Viewer Application">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        style-src ${webview.cspSource} 'unsafe-inline';
        font-src ${webview.cspSource};
        script-src ${webview.cspSource} 'unsafe-eval' 'unsafe-inline';
        img-src ${webview.cspSource} data:;
        connect-src ${webview.cspSource};
    ">

    <link rel="icon" type="image/svg+xml" href="${faviconUri}">
    <link rel="stylesheet" href="${styleUri}">
    <link rel="stylesheet" href="${overrideCssUri}">

    <script>
        // Set WASM URL for ThorVG before loading lottie-player
        window.THORVG_WASM_URL = '${wasmUri}';
        // Set Stats.js URL for vscode-bridge
        window.STATS_JS_URL = '${statsJsUri}';
    </script>
    <script src="${lottiePlayerUri}"></script>

    <style>
        /* Override icon paths for VSCode webview */
        .ctrl-button.stats img { content: url('${statsIconUri}'); }
        .ctrl-button.dark img { content: url('${darkIconUri}'); }
        .ctrl-button.history img { content: url('${historyIconUri}'); }
        .ctrl-button.close img { content: url('${closeIconUri}'); }
    </style>
</head>
<body class="">
    <div class="root-container">
        <div class="preview">
            <button id="drawer-toggle" class="button drawer-toggle"></button>
            <div id="image-area">
                <div id="image-placeholder">
                    <p>Drag and drop a file here or click to browse<br/>(.svg, lottie: .json/.lot)</p>
                </div>
                <input id="image-file-selector" type="file" accept=".svg,.lot,.json,.jpg,.png" multiple>
            </div>
            <div id="console-area" class=""></div>
            <div class="info-area"><p id="version">ThorVG v1.0.0-pre31 · Software</p></div>
            <div class="actions">
                <button title="Stats Mode" class="button button-stats"></button>
                <button title="Dark Mode" class="button button-dark"></button>
                <button title="History" class="button button-history" id="nav-history"></button>
                <label id="nav-stats-mode" class="toggle"><input type="checkbox"></label>
                <label id="nav-dark-mode" class="toggle"><input type="checkbox"></label>
            </div>
        </div>
        <aside class="drawer">
            <div class="controls">
                <div class="section-controls">
                    <div class="ctrl-top-menu">
                        <div class="ctrl-button-set">
                        <button class="ctrl-button stats">
                        <img src="${statsIconUri}" />
                        </button>
                        <button class="ctrl-button dark">
                        <img src="${darkIconUri}" />
                        </button>
                        <button class="ctrl-button history">
                        <img src="${historyIconUri}" />
                        </button>
                        </div>
                        <button class="ctrl-button close">
                        <img src="${closeIconUri}" />
                        </button>
                    </div>
                    <div class="control-item">
                        <div class="item-expand">
                            <h2 class="ctrl-title">Canvas</h2>
                            <button type="button" aria-expanded="true" aria-controls="accordion-panel-171" class="expand-button" aria-label="Toggle Canvas section">
                                <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" stroke-width="0.125em" class="expand-icon">
                                    <path d="M6 9l6 6 6-6"></path>
                                </svg>
                            </button>
                        </div>
                        <div role="region" class="inner-container column">
                            <h4 class="ctrl-description" id="zoom-value">800 X 800</h4>
                            <div id="zoom-slider-container">
                                <input id="zoom-slider" type="range" min="0" max="300" value="100" disabled />
                            </div>
                        </div>
                    </div>
                    <div class="control-item">
                        <div class="item-expand">
                            <h2 class="ctrl-title">Progress</h2>
                            <button type="button" aria-expanded="true" aria-controls="accordion-panel-172" class="expand-button" aria-label="Toggle Progress section">
                                <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" stroke-width="0.125em" class="expand-icon">
                                    <path d="M6 9l6 6 6-6"></path>
                                </svg>
                            </button>
                        </div>
                        <div role="region" class="inner-container column">
                            <h4 class="ctrl-description" id="progress-value">0 / 0</h4>
                            <div id="progress-slider-container">
                                <input id="progress-slider" type="range" min="0" max="100" value="0" disabled />
                            </div>
                            <div class="progress-button-container">
                                <div class="progress-button" id="progress-play">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512">
                                        <path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80L0 432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L361 297c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"/>
                                    </svg>
                                </div>
                                <div class="progress-button" id="progress-pause">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512">
                                        <path d="M48 64C21.5 64 0 85.5 0 112L0 400c0 26.5 21.5 48 48 48l32 0c26.5 0 48-21.5 48-48l0-288c0-26.5-21.5-48-48-48L48 64zm192 0c-26.5 0-48 21.5-48 48l0 288c0 26.5 21.5 48 48 48l32 0c26.5 0 48-21.5 48-48l0-288c0-26.5-21.5-48-48-48l-32 0z"/>
                                    </svg>
                                </div>
                                <div class="progress-button" id="progress-stop">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512">
                                        <path d="M0 128C0 92.7 28.7 64 64 64H320c35.3 0 64 28.7 64 64V384c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V128z"/>
                                    </svg>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="control-item">
                        <div class="item-expand">
                            <h2 class="ctrl-title">Render Backend</h2>
                            <button type="button" aria-expanded="true" aria-controls="accordion-panel-173" class="expand-button" aria-label="Toggle Render Backend section">
                                <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" stroke-width="0.125em" class="expand-icon">
                                    <path d="M6 9l6 6 6-6"></path>
                                </svg>
                            </button>
                        </div>
                        <div role="region" class="inner-container column">
                            <div id="renderer-select" class="tab">
                                <select id="renderer-dropdown">
                                    <option value="sw">Software</option>
                                    <option value="gl">WebGL</option>
                                    <option value="wg">WebGPU</option>
                                </select>
                                <svg class="arrow-icon" viewBox="0 0 24 24">
                                    <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-linejoin="round" stroke-width="0.15em" fill="none" />
                                </svg>
                            </div>
                        </div>
                    </div>
                    <div class="control-item">
                        <div class="item-expand">
                            <h2 class="ctrl-title">Effects Quality</h2>
                            <button type="button" aria-expanded="true" aria-controls="accordion-panel-174" class="expand-button" aria-label="Toggle Effects Quality section">
                                <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" stroke-width="0.125em" class="expand-icon">
                                    <path d="M6 9l6 6 6-6"></path>
                                </svg>
                            </button>
                        </div>
                        <div role="region" class="inner-container column">
                            <div id="quality-select" class="tab">
                                <select id="quality-dropdown">
                                    <option value="30">Low</option>
                                    <option value="60">Medium</option>
                                    <option value="90">High</option>
                                </select>
                                <svg class="arrow-icon" viewBox="0 0 24 24">
                                    <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-linejoin="round" stroke-width="0.15em" fill="none" />
                                </svg>
                            </div>
                        </div>
                    </div>
                    <div class="control-item">
                        <div class="item-expand">
                            <h2 class="ctrl-title">Export</h2>
                            <button type="button" aria-expanded="true" aria-controls="accordion-panel-174" class="expand-button" aria-label="Toggle Export section">
                                <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" stroke-width="0.125em" class="expand-icon">
                                    <path d="M6 9l6 6 6-6"></path>
                                </svg>
                            </button>
                        </div>
                        <div class="inner-container row">
                            <button type="button" class="ctrl-button" id="export-png">png</button>
                            <button type="button" class="ctrl-button" id="export-gif">gif</button>
                        </div>
                    </div>
                    <div class="control-item">
                        <div class="item-expand">
                            <h2 class="ctrl-title">Details</h2>
                            <button type="button" aria-expanded="true" aria-controls="accordion-panel-175" class="expand-button" aria-label="Toggle Details section">
                                <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" stroke-width="0.125em" class="expand-icon">
                                    <path d="M6 9l6 6 6-6"></path>
                                </svg>
                            </button>
                        </div>
                        <div role="region" class="inner-container column">
                            <div id="file-detail">
                                <div class="placeholder">
                                    <h4 class="ctrl-description">No file information</h4>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="control-item" style="min-height: 400px;">
                        <div class="item-expand">
                            <h2 class="ctrl-title">List Of Files</h2>
                            <button type="button" aria-expanded="true" aria-controls="accordion-panel-176" class="expand-button" aria-label="Toggle List Of Files section">
                                <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" stroke-width="0.125em" class="expand-icon">
                                    <path d="M6 9l6 6 6-6"></path>
                                </svg>
                            </button>
                        </div>
                        <div role="region" class="inner-container">
                            <div id="files-list">
                                <div class="container"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="section-upload">
                    <h2 class="ctrl-title">Upload</h2>
                    <div class="inner-container row">
                        <input type="file" id="hidden-file-input" accept=".svg, .json, .lot" style="display: none;" />
                        <button type="button" class="ctrl-button" id="add-file-local">File</button>
                        <button type="button" class="ctrl-button" id="add-file-url">Url</button>
                    </div>
                </div>
            </div>
        </aside>
        <div id="drawer-backdrop" class="drawer-backdrop"></div>
    </div>
    <script type="text/javascript" src="${bridgeJsUri}"></script>
    <script type="text/javascript" src="${mainJsUri}"></script>
</body>
</html>`;
    }
}
