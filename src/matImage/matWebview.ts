/**
 * matWebview.ts — HTML/JS template for the 2D Image Viewer webview.
 *
 * Features rendered client-side (no framework, vanilla JS + Canvas API):
 *   - Render raw bytes → ImageData → canvas
 *   - Auto-normalise float data to [0,255]
 *   - Colormap selection (gray / jet / viridis / hot / plasma)
 *   - Channel order toggle (BGR ↔ RGB)
 *   - Scroll-wheel zoom (up to 100×), drag-to-pan
 *   - Hover pixel info (coords + RGBA values)
 *   - Save PNG / Save TIFF buttons
 *   - postMessage API for live refresh and viewport sync
 */

import * as vscode from "vscode";
import { ImageData } from "../viewers/viewerTypes";

export function buildImageWebviewHtml(
    varName: string,
    data: ImageData,
    webview: vscode.Webview,
    context: vscode.ExtensionContext
): string {
    const mediaUri = (file: string) =>
        webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, "media", file)
        );

    const nonce = generateNonce();
    const cfg = vscode.workspace.getConfiguration("matrixViewer");
    const defaultColormap = cfg.get<string>("defaultColormap", "gray");
    const maxDisplaySize = cfg.get<number>("maxDisplaySize", 50);

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             img-src ${webview.cspSource} data: blob:;
             script-src 'nonce-${nonce}';
             style-src ${webview.cspSource} 'unsafe-inline';">
  <title>${varName}</title>
  <link rel="stylesheet" href="${mediaUri("image-viewer.css")}">
</head>
<body>
  <div id="toolbar">
    <span id="info-label"></span>
    <label>Normalize <input type="checkbox" id="chk-normalize" ${!data.isUint8 ? "checked" : ""}></label>
    <label ${data.channels > 1 ? "hidden" : ""}>Colormap
      <select id="sel-colormap">
        <option value="gray">Gray</option>
        <option value="jet">Jet</option>
        <option value="viridis">Viridis</option>
        <option value="hot">Hot</option>
        <option value="plasma">Plasma</option>
      </select>
    </label>
    <label>BGR→RGB <input type="checkbox" id="chk-bgr2rgb" ${(data.format === "BGR" || data.format === "BGRA") ? "checked" : ""}></label>
    <button id="btn-reset">Reset</button>
    <button id="btn-save-png">Save PNG</button>
  </div>

  <div id="canvas-container">
    <canvas id="main-canvas"></canvas>
    <div id="hover-info"></div>
  </div>

  <script nonce="${nonce}" src="${mediaUri("colormaps.js")}"></script>
  <script nonce="${nonce}">
    // ── Bootstrap data injected from extension ──────────────────────────
    const INIT_DATA = ${JSON.stringify(data)};

    // Bootstrap the viewer — full implementation is in image-viewer.js
    // loaded below; this object is picked up by that script.
    window.__matrixViewer = {
      initData: INIT_DATA,
      defaultColormap: ${JSON.stringify(defaultColormap)},
      maxDisplaySize: ${maxDisplaySize}
    };
  </script>
  <script nonce="${nonce}" src="${mediaUri("image-viewer.js")}"></script>
</body>
</html>`;
}

function generateNonce(): string {
    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length: 32 }, () =>
        chars[Math.floor(Math.random() * chars.length)]
    ).join("");
}
