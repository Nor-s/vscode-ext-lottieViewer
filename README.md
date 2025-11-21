# ThorVG Viewer for VSCode

A Visual Studio Code extension that integrates [ThorVG Viewer](https://github.com/thorvg/thorvg.viewer) for viewing and previewing Lottie animations, SVG files, and other vector graphics.

## Features

- **Real-time Preview**: View Lottie (.json, .lot) and SVG files directly in VSCode
- **Auto-sync**: Automatically updates preview when you edit the file
- **Export Options**: Export animations to PNG or GIF
- **Performance Stats**: View FPS, memory usage, and rendering statistics
- **Animation Controls**: Play, pause, loop, and adjust playback speed
- **File Upload**: Drag & drop or click to load animation files
- **Dark Mode**: Supports VSCode theme-aware styling

## Getting Started

### Prerequisites

- Visual Studio Code (v1.85.0 or higher)
- Node.js (v18 or higher) - for development only

### Installation

#### From VSIX Package

```bash
code --install-extension thorvg-viewer-0.0.1.vsix
```

Or install via VSCode UI:
1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Type "Extensions: Install from VSIX..."
3. Select the `thorvg-viewer-0.0.1.vsix` file

#### From Source

1. Clone this repository with submodules:
   ```bash
   git clone --recursive https://github.com/Nor-s/vscode-ext-lottieViewer.git
   cd vscode-ext-lottieViewer
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile TypeScript:
   ```bash
   npm run compile
   ```

4. Press `F5` in VSCode to launch Extension Development Host

## Usage

### Opening ThorVG Viewer

**Method 1: Command Palette**
1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P`)
2. Type "Open ThorVG Viewer"
3. Select the command

**Method 2: Editor Icon (Recommended)**
1. Open a `.svg`, `.json`, or `.lot` file
2. Click the ThorVG icon in the editor title bar (top-right)
3. The viewer opens with your file automatically loaded and synced

**Method 3: Auto-sync Current File**
- When you click the editor icon, the viewer automatically:
  - Loads your current file
  - Syncs changes as you edit
  - Switches to the active file when you change editors

### Viewer Features

- **Upload File**: Drag & drop or click the upload area to load files
- **Export**:
  - Export PNG: Capture current frame as PNG image
  - Export GIF: Convert animation to animated GIF
- **Stats Button**: Toggle FPS, memory, and rendering statistics
- **Canvas Controls**:
  - Adjust canvas size
  - Enable/disable repeat (loop)
  - Control playback speed
  - Show/hide history panel

## Commands

All commands are accessible via Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):

- **ThorVG: Open Viewer** - Open ThorVG Viewer panel
- **ThorVG: Open Viewer with Current File** - Open ThorVG Viewer with current file and enable auto-sync
- **ThorVG: Open Extension Folder** - Open `thorvg-viewer` folder (contains `thorvg.wasm`) for easy WASM updates

## Project Structure

```
.
├── src/
│   ├── extension.ts                    # Extension entry point
│   └── webview/
│       ├── ThorVGViewerPanel.ts       # Main ThorVG Viewer panel
│       ├── TestAutomationPanel.ts     # Test automation panel (future)
│       └── WebviewPanel.ts            # Base webview panel
├── media/
│   ├── vscode-bridge.js               # VSCode <-> Webview bridge
│   ├── stats.min.js                   # Stats.js library
│   └── favicon_white.svg              # Dark mode icon
├── thorvg-viewer/                     # ThorVG Viewer submodule
│   ├── index.html
│   ├── main.js
│   ├── style.css
│   ├── thorvg.wasm                    # ThorVG WebAssembly
│   └── icon/                          # UI icons
├── thorvg.test-automation/            # Test automation submodule (future)
├── package.json                       # Extension manifest
├── tsconfig.json                      # TypeScript configuration
└── README.md                          # This file
```

## Development

### Compile TypeScript

```bash
npm run compile
```

### Watch Mode

```bash
npm run watch
```

### Package Extension

```bash
# Install vsce if not already installed
npm install -g @vscode/vsce

# Package extension
vsce package
```

This creates a `.vsix` file that can be installed in VSCode.

### Debugging

1. Open the project in VSCode
2. Press `F5` to launch Extension Development Host
3. In the new window, open a `.svg`, `.json`, or `.lot` file
4. Click the ThorVG icon to test the viewer
5. Press `Ctrl+Shift+I` (or `Cmd+Shift+I`) to open DevTools
6. Use "Developer: Open Webview Developer Tools" to inspect webview content

## Custom WASM Build

To use a custom ThorVG WASM build:

### Method 1: Using Command (Recommended)

1. Open Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
2. Type "ThorVG: Open Extension Folder"
3. Choose "Open Folder" from the quick pick menu
4. Replace `thorvg.wasm` with your custom build
5. Reload VSCode window (`Ctrl+Shift+P` → "Developer: Reload Window")

### Method 2: Manual Path

1. Locate your extension installation directory:
   - **Windows**: `%USERPROFILE%\.vscode\extensions\nor-s.thorvg-viewer-0.0.1\thorvg-viewer\`
   - **Linux/Mac**: `~/.vscode/extensions/nor-s.thorvg-viewer-0.0.1/thorvg-viewer/`
   - **WSL**: `~/.vscode-server/extensions/nor-s.thorvg-viewer-0.0.1/thorvg-viewer/`

2. Replace `thorvg.wasm` with your custom build

3. Reload VSCode window (`Ctrl+Shift+P` → "Developer: Reload Window")

**Note**: The version number in the path may change with updates.

## Supported File Formats

- **Lottie**: `.json`, `.lot`
- **SVG**: `.svg`

## Known Issues

- Large animation files may take time to load
- GIF export quality depends on animation complexity

## Release Notes

### 0.0.1

- Initial release with ThorVG Viewer integration
- Real-time preview for Lottie and SVG files
- Auto-sync feature for live editing
- Export to PNG/GIF
- Performance statistics overlay
- Editor toolbar integration

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Acknowledgments

- [ThorVG](https://github.com/thorvg/thorvg) - High-performance vector graphics library
- [ThorVG Viewer](https://github.com/thorvg/thorvg.viewer) - Web-based vector graphics viewer
- [Stats.js](https://github.com/mrdoob/stats.js) - Performance monitoring library

## License

This extension is provided as-is. Please refer to ThorVG's license for the underlying rendering engine.

## Links

- [GitHub Repository](https://github.com/Nor-s/vscode-ext-lottieViewer)
- [ThorVG Project](https://github.com/thorvg/thorvg)
- [Report Issues](https://github.com/Nor-s/vscode-ext-lottieViewer/issues)
