/**
 * image-viewer.js — Front-end logic for the 2D Image Viewer webview.
 *
 * Picks up bootstrap data from window.__matrixViewer.initData and renders
 * the image on a <canvas> element. Handles zoom/pan, normalisation,
 * colormap, channel reorder, hover info, and save actions.
 *
 * Also listens for postMessage "update" and "syncViewport" from the extension.
 *
 * @typedef {import('../src/matImage/matProvider').ImageData} ImageData
 */

(function () {
  "use strict";

  const vscode = acquireVsCodeApi();

  /** @type {ImageData} */
  const initData = window.__matrixViewer.initData;

  // ── State ─────────────────────────────────────────────────────────────────

  let currentData = initData;
  let zoom = 1.0;
  let panX = 0;
  let panY = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let normalize = !initData.isUint8;
  let colormap = "gray";
  let swapBGR = false;

  // ── DOM refs ──────────────────────────────────────────────────────────────

  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("main-canvas"));
  const ctx = canvas.getContext("2d");
  const hoverInfo = document.getElementById("hover-info");
  const infoLabel = document.getElementById("info-label");
  const chkNormalize = /** @type {HTMLInputElement} */ (document.getElementById("chk-normalize"));
  const selColormap = /** @type {HTMLSelectElement} */ (document.getElementById("sel-colormap"));
  const chkBGR = /** @type {HTMLInputElement} */ (document.getElementById("chk-bgr2rgb"));
  const btnReset = document.getElementById("btn-reset");
  const btnSavePng = document.getElementById("btn-save-png");

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    chkNormalize.checked = normalize;
    renderImage(currentData);
    infoLabel.textContent = `${currentData.height}×${currentData.width}  ch:${currentData.channels}  ${currentData.dtype}`;

    chkNormalize.addEventListener("change", () => {
      normalize = chkNormalize.checked;
      renderImage(currentData);
    });
    selColormap.addEventListener("change", () => {
      colormap = selColormap.value;
      renderImage(currentData);
    });
    chkBGR.addEventListener("change", () => {
      swapBGR = chkBGR.checked;
      renderImage(currentData);
    });
    btnReset.addEventListener("click", resetView);
    btnSavePng.addEventListener("click", savePng);

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", () => { isDragging = false; });
    canvas.addEventListener("mouseleave", () => {
      isDragging = false;
      hoverInfo.style.display = "none";
    });
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /**
   * Decode raw bytes → RGBA ImageData → paint to canvas.
   * @param {ImageData} data
   */
  function renderImage(data) {
    const { width, height, channels, dtype, b64Bytes, dataMin, dataMax } = data;

    canvas.width = width;
    canvas.height = height;

    // Decode Base64 bytes
    const binaryStr = atob(b64Bytes);
    const rawBytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      rawBytes[i] = binaryStr.charCodeAt(i);
    }

    const pixels = decodeToRGBA(rawBytes, width, height, channels, dtype, dataMin, dataMax);
    const imageData = new ImageData(pixels, width, height);

    // Draw onto an offscreen canvas, then transform for zoom/pan
    const off = new OffscreenCanvas(width, height);
    off.getContext("2d").putImageData(imageData, 0, 0);

    ctx.save();
    ctx.setTransform(zoom, 0, 0, zoom, panX, panY);
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }

  /**
   * Convert raw typed-array bytes to a flat RGBA Uint8ClampedArray.
   * @returns {Uint8ClampedArray}
   */
  function decodeToRGBA(rawBytes, width, height, channels, dtype, dataMin, dataMax) {
    const n = width * height;
    const out = new Uint8ClampedArray(n * 4);
    const typed = viewAsTyped(rawBytes, dtype);
    const scale = normalize ? 255 / (dataMax - dataMin || 1) : 1;

    for (let i = 0; i < n; i++) {
      let r, g, b;
      if (channels === 1) {
        const val = (typed[i] - (normalize ? dataMin : 0)) * scale;
        if (colormap === "gray" || !colormap) {
          r = g = b = val;
        } else {
          [r, g, b] = applyColormap(val / 255, colormap);
        }
      } else {
        const base = i * channels;
        const ch0 = (typed[base + 0] - (normalize ? dataMin : 0)) * scale;
        const ch1 = (typed[base + 1] - (normalize ? dataMin : 0)) * scale;
        const ch2 = (typed[base + 2] - (normalize ? dataMin : 0)) * scale;
        // OpenCV default: BGR
        if (swapBGR && channels >= 3) {
          r = ch2; g = ch1; b = ch0;
        } else {
          r = ch0; g = ch1; b = ch2;
        }
      }
      out[i * 4 + 0] = r;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = b;
      out[i * 4 + 3] = 255;
    }
    return out;
  }

  // ── Interaction ───────────────────────────────────────────────────────────

  function onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(100, Math.max(0.1, zoom * factor));
    // Zoom towards cursor
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    panX = cx - (cx - panX) * (newZoom / zoom);
    panY = cy - (cy - panY) * (newZoom / zoom);
    zoom = newZoom;
    renderImage(currentData);
    broadcastViewport();
  }

  function onMouseDown(e) {
    isDragging = true;
    dragStartX = e.clientX - panX;
    dragStartY = e.clientY - panY;
  }

  function onMouseMove(e) {
    if (isDragging) {
      panX = e.clientX - dragStartX;
      panY = e.clientY - dragStartY;
      renderImage(currentData);
      broadcastViewport();
    }

    // Hover pixel info
    const rect = canvas.getBoundingClientRect();
    const imgX = Math.floor((e.clientX - rect.left - panX) / zoom);
    const imgY = Math.floor((e.clientY - rect.top - panY) / zoom);
    if (imgX >= 0 && imgX < currentData.width && imgY >= 0 && imgY < currentData.height) {
      const pixelValues = getPixelValues(imgX, imgY);
      hoverInfo.textContent = `(${imgX}, ${imgY})  ${pixelValues}`;
      hoverInfo.style.display = "block";
      hoverInfo.style.left = (e.clientX - rect.left + 12) + "px";
      hoverInfo.style.top = (e.clientY - rect.top + 12) + "px";
    }
  }

  function resetView() {
    zoom = 1;
    panX = 0;
    panY = 0;
    renderImage(currentData);
  }

  // ── Pixel Inspection ──────────────────────────────────────────────────────

  function getPixelValues(x, y) {
    // Re-read from current rendered ImageData
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = currentData.width;
    tempCanvas.height = currentData.height;
    const tempCtx = tempCanvas.getContext("2d");
    const binaryStr = atob(currentData.b64Bytes);
    const rawBytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) { rawBytes[i] = binaryStr.charCodeAt(i); }
    const typed = viewAsTyped(rawBytes, currentData.dtype);
    const base = (y * currentData.width + x) * currentData.channels;
    const vals = [];
    for (let c = 0; c < currentData.channels; c++) {
      vals.push(typed[base + c].toFixed(currentData.dtype.includes("float") ? 4 : 0));
    }
    return `[${vals.join(", ")}]`;
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  function savePng() {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${currentData.varName}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // ── Sync ──────────────────────────────────────────────────────────────────

  function broadcastViewport() {
    vscode.postMessage({ type: "syncViewport", zoom, panX, panY });
  }

  // ── VS Code message listener ──────────────────────────────────────────────

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg.type === "update" && msg.data) {
      currentData = msg.data;
      infoLabel.textContent = `${currentData.height}×${currentData.width}  ch:${currentData.channels}  ${currentData.dtype}`;
      renderImage(currentData);
    } else if (msg.type === "syncViewport") {
      zoom = msg.zoom;
      panX = msg.panX;
      panY = msg.panY;
      renderImage(currentData);
    }
  });

  // ── Typed-buffer helper ────────────────────────────────────────────────────

  function viewAsTyped(rawBytes, dtype) {
    const ab = rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength);
    switch (dtype) {
      case "uint8":   return new Uint8Array(ab);
      case "int8":    return new Int8Array(ab);
      case "uint16":  return new Uint16Array(ab);
      case "int16":   return new Int16Array(ab);
      case "uint32":  return new Uint32Array(ab);
      case "int32":   return new Int32Array(ab);
      case "float32": return new Float32Array(ab);
      case "float64": return new Float64Array(ab);
      default:        return new Float32Array(ab);
    }
  }

  // Colormap tables are provided by colormaps.js (window.COLORMAPS)
  function applyColormap(t, name) {
    if (window.COLORMAPS && window.COLORMAPS[name]) {
      return window.COLORMAPS[name](t);
    }
    const v = t * 255;
    return [v, v, v];
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  init();
})();
