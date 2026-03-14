/**
 * plotWebview.ts — HTML/JS template for the 1D Plot Viewer.
 *
 * Renders using lightweight uPlot (fast canvas-based, no React/Vue).
 * Features:
 *   - Line / Scatter / Histogram modes
 *   - Scroll-wheel zoom, drag-to-pan, box-select zoom
 *   - Custom X-axis support (xValues)
 *   - Stats panel (min/max/mean/std)
 *   - Save PNG / Save CSV buttons
 *   - postMessage API for live refresh and viewport sync
 */

import * as vscode from "vscode";
import { PlotData } from "../viewers/viewerTypes";

export function buildPlotWebviewHtml(
    varName: string,
    data: PlotData,
    webview: vscode.Webview,
    context: vscode.ExtensionContext
): string {
    const mediaUri = (file: string) =>
        webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, "media", file)
        );

    const nonce = generateNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             img-src ${webview.cspSource} data: blob:;
             script-src 'nonce-${nonce}' 'unsafe-eval';
             style-src ${webview.cspSource} 'unsafe-inline';">
  <title>${varName}</title>
  <link rel="stylesheet" href="${mediaUri("plot-viewer.css")}">
</head>
<body>
  <div id="toolbar">
    <span id="stats-label"></span>
    <label>Mode
      <select id="sel-mode">
        <option value="line">Line</option>
        <option value="scatter">Scatter</option>
        <option value="histogram">Histogram</option>
      </select>
    </label>
    <button id="btn-reset">Reset</button>
    <button id="btn-hist-config" style="display:none">Config</button>
    <button id="btn-save-png">Save PNG</button>
    <button id="btn-save-csv">Save CSV</button>
  </div>
  <div id="plot-container"></div>

  <script nonce="${nonce}">
    window.__matrixViewer = { initData: ${JSON.stringify(data)} };
  </script>
  <script nonce="${nonce}" src="${mediaUri("uplot.iife.min.js")}"></script>
  <script nonce="${nonce}" src="${mediaUri("plot-viewer.js")}"></script>
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
