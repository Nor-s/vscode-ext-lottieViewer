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
        void this._update();

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

    private async _update(): Promise<void> {
        const webview = this._panel.webview;
        try {
            this._panel.webview.html = await this._getHtmlForWebview(webview);
        } catch (error) {
            console.error('ThorVG Viewer: Failed to load webview HTML', error);
            this._panel.webview.html = '<!DOCTYPE html><html><body><h1>ThorVG Viewer</h1><p>Failed to load webview content.</p></body></html>';
        }
    }

    private async _getHtmlForWebview(webview: vscode.Webview): Promise<string> {
        // Get resource URIs for ThorVG Viewer assets (from thorvg-viewer submodule)
        const thorvgViewerUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'thorvg-viewer')
        );
        const bridgeJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode-bridge.js')
        );
        const indexHtmlPath = vscode.Uri.joinPath(this._extensionUri, 'thorvg-viewer', 'index.html');
        const htmlBytes = await vscode.workspace.fs.readFile(indexHtmlPath);
        let html = new TextDecoder('utf-8').decode(htmlBytes);

        const baseUri = `${thorvgViewerUri.toString()}/`;
        const csp = [
            "default-src 'none';",
            `style-src ${webview.cspSource} 'unsafe-inline' https:;`,
            `font-src ${webview.cspSource} https:;`,
            `script-src ${webview.cspSource} 'unsafe-eval' 'unsafe-inline' https://mrdoob.github.io;`,
            `img-src ${webview.cspSource} data: blob: https:;`,
            `connect-src ${webview.cspSource} https:;`
        ].join(' ');

        const headInjection = `
    <base href="${baseUri}">
    <meta http-equiv="Content-Security-Policy" content="${csp}">`;

        html = html.replace('<head>', `<head>${headInjection}`);
        html = html.replace(
            '</body>',
            `    <script type="text/javascript" src="${bridgeJsUri}"></script>
</body>`
        );

        return html;
    }
}
