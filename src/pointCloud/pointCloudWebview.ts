/**
 * pointCloudWebview.ts — HTML/JS template for the 3D Point Cloud Viewer.
 *
 * Uses Three.js (loaded from media/) for point cloud rendering.
 * Features:
 *   - Orbit controls: drag to rotate, scroll to zoom, right-drag to pan
 *   - Axis colouring (colour by X / Y / Z using a gradient LUT)
 *   - Per-point RGB colouring when available
 *   - Adjustable point size
 *   - Export PLY button
 *   - postMessage API for live refresh and viewport sync
 */

import * as vscode from "vscode";
import { PointCloudData } from "./pointCloudProvider";

export function buildPointCloudWebviewHtml(
  varName: string,
  data: PointCloudData,
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
  <link rel="stylesheet" href="${mediaUri("pointcloud-viewer.css")}">
</head>
<body>
  <div id="toolbar">
    <span id="info-label">${data.pointCount} points</span>
    <label>Color by
      <select id="sel-coloraxis">
        <option value="xyz">Original RGB</option>
        <option value="x">X axis</option>
        <option value="y">Y axis</option>
        <option value="z">Z axis</option>
      </select>
    </label>
    <label>Point size
      <input type="range" id="rng-pointsize" min="1" max="10" value="2">
    </label>
    <button id="btn-reset">Reset View</button>
    <button id="btn-save-ply">Save PLY</button>
  </div>
  <div id="canvas-container"></div>

  <script nonce="${nonce}">
    window.__matrixViewer = { initData: ${JSON.stringify(data)} };
  </script>
  <script nonce="${nonce}" src="${mediaUri("three.min.js")}"></script>
  <script nonce="${nonce}" src="${mediaUri("OrbitControls.js")}"></script>
  <script nonce="${nonce}" src="${mediaUri("pointcloud-viewer.js")}"></script>
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
