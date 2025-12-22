import * as vscode from 'vscode';

const defaultViewerSize = 256;

export class ThorVGViewerPanel {
    public static currentPanel: ThorVGViewerPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, autoSync: boolean = true) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        // If we already have a panel, show it
        if (ThorVGViewerPanel.currentPanel) {
            ThorVGViewerPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'thorvgViewer',
            'ThorVG Viewer',
            vscode.ViewColumn.Beside,
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
        const targetColumn = vscode.ViewColumn.Beside;

        // If we already have a panel, show it and load current file
        if (ThorVGViewerPanel.currentPanel) {
            ThorVGViewerPanel.currentPanel._panel.reveal(targetColumn);
            return;
        }

        // Otherwise, create a new panel with auto-sync enabled
        const panel = vscode.window.createWebviewPanel(
            'thorvgViewer',
            'ThorVG Viewer',
            targetColumn,
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
        // const bridgeJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode-bridge.js'));

        const indexHtmlPath = vscode.Uri.joinPath(this._extensionUri, 'thorvg-viewer', 'index.html');
        const htmlBytes = await vscode.workspace.fs.readFile(indexHtmlPath);
        let html = new TextDecoder('utf-8').decode(htmlBytes);

        const thorvgViewerUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'thorvg-viewer'));
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
        // html = html.replace(
            // '</body>',
            // `    <script type="text/javascript" src="${bridgeJsUri}"></script>
            // </body>`
        // );

        return html;
    }
}
