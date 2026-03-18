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
  let colormap = window.__matrixViewer.defaultColormap ?? "gray";
  // Derive initial BGR-swap state from the image format reported by the extension.
  // BGR and BGRA images need R/B channels swapped before display.
  let swapBGR = (initData.format === "BGR" || initData.format === "BGRA");

  /**
   * Cached decoded pixel bytes for "raw"/"deflate" encoding.
   * Cleared when currentData changes; populated lazily on first ensureRawBytes().
   * @type {Uint8Array|null}
   */
  let currentRawBytes = null;

  /**
   * Cached ImageBitmap for "png" encoding.
   * Cleared when currentData changes; populated lazily on first ensureBitmap().
   * @type {ImageBitmap|null}
   */
  let currentBitmap = null;

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
    selColormap.value = colormap;
    chkBGR.checked = swapBGR;
    fitToWindow(currentData);
    renderImage(currentData).catch(console.error);
    const fmtStr = currentData.format ? `  ${currentData.format}` : "";
    infoLabel.textContent = `${currentData.height}×${currentData.width}  ch:${currentData.channels}  ${currentData.dtype}${fmtStr}`;

    chkNormalize.addEventListener("change", () => {
      normalize = chkNormalize.checked;
      renderImage(currentData).catch(console.error);
    });
    selColormap.addEventListener("change", () => {
      colormap = selColormap.value;
      renderImage(currentData).catch(console.error);
    });
    chkBGR.addEventListener("change", () => {
      swapBGR = chkBGR.checked;
      renderImage(currentData).catch(console.error);
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
   * Render the current image onto the canvas.
   *
   * Three paths depending on data.encoding:
   *   "png"                        — decompress via ImageBitmap (Python-side PNG encode)
   *   "deflate"/"gzip"/"deflate-raw" — decompress via DecompressionStream, then RGBA path
   *   "raw" / undefined            — existing direct typed-array path
   *
   * Decoded results are cached in currentRawBytes / currentBitmap so
   * repeated zoom/pan renders do not re-decompress.
   *
   * @param {Object} data — ImageData object from the extension
   * @returns {Promise<void>}
   */
  async function renderImage(data) {
    const { width, height, channels, dtype, dataMin, dataMax } = data;
    const encoding = data.encoding;

    // Size the canvas to the container so zoom/pan work in the full viewport
    const container = canvas.parentElement;
    const cw = container.clientWidth  || width;
    const ch = container.clientHeight || height;
    canvas.width  = cw;
    canvas.height = ch;

    const maxMegapixels = window.__matrixViewer.maxDisplaySize ?? 50;

    if (encoding === "png") {
      // ── PNG path ──────────────────────────────────────────────────────────
      // Pixel bytes were PNG-encoded on the Python side. Decode into an
      // ImageBitmap (hardware-accelerated) and draw directly.
      const bmp = await ensureBitmap(data);
      if (!bmp) { return; }

      let displaySrc = bmp;
      if (width * height > maxMegapixels * 1e6) {
        const scale = Math.sqrt(maxMegapixels * 1e6 / (width * height));
        const dw = Math.max(1, Math.round(width * scale));
        const dh = Math.max(1, Math.round(height * scale));
        const sampled = new OffscreenCanvas(dw, dh);
        sampled.getContext("2d").drawImage(bmp, 0, 0, dw, dh);
        displaySrc = sampled;
      }

      ctx.save();
      ctx.setTransform(zoom, 0, 0, zoom, panX, panY);
      ctx.drawImage(displaySrc, 0, 0, width, height);
      ctx.restore();

    } else {
      // ── raw / deflate path ────────────────────────────────────────────────
      // Ensure raw pixel bytes are available (decompress if necessary),
      // then run the full typed-array → RGBA → canvas pipeline.
      const rawBytes = await ensureRawBytes(data);
      if (!rawBytes) { return; }

      const pixels = decodeToRGBA(rawBytes, width, height, channels, dtype, dataMin, dataMax);
      const imageData = new ImageData(pixels, width, height);

      const off = new OffscreenCanvas(width, height);
      off.getContext("2d").putImageData(imageData, 0, 0);

      let displaySrc = off;
      if (width * height > maxMegapixels * 1e6) {
        const scale = Math.sqrt(maxMegapixels * 1e6 / (width * height));
        const dw = Math.max(1, Math.round(width * scale));
        const dh = Math.max(1, Math.round(height * scale));
        const sampled = new OffscreenCanvas(dw, dh);
        sampled.getContext("2d").drawImage(off, 0, 0, dw, dh);
        displaySrc = sampled;
      }

      ctx.save();
      ctx.setTransform(zoom, 0, 0, zoom, panX, panY);
      ctx.drawImage(displaySrc, 0, 0, width, height);
      ctx.restore();
    }
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
      let r, g, b, a = 255;
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
        // Preserve alpha channel when present (RGBA / BGRA)
        if (channels === 4) {
          a = (typed[base + 3] - (normalize ? dataMin : 0)) * scale;
        }
      }
      out[i * 4 + 0] = r;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = b;
      out[i * 4 + 3] = a;
    }
    return out;
  }

  // ── Decode helpers ────────────────────────────────────────────────────────

  /**
   * Decode a base64 string to a Uint8Array (synchronous).
   * @param {string} b64
   * @returns {Uint8Array}
   */
  function b64ToUint8Array(b64) {
    const binaryStr = atob(b64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Decompress a base64-encoded byte stream using the browser-native
   * DecompressionStream API (no third-party library required).
   *
   * @param {string} b64       — base64-encoded compressed bytes
   * @param {string} algorithm — DecompressionStream algorithm tag:
   *                             "deflate" | "gzip" | "deflate-raw"
   * @returns {Promise<Uint8Array>}
   */
  async function decompress(b64, algorithm) {
    const compressed = b64ToUint8Array(b64);
    const ds = new DecompressionStream(algorithm);
    const writer = ds.writable.getWriter();
    writer.write(compressed);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) { break; }
      chunks.push(value);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.length; }
    return out;
  }

  /** Compressed encoding tags that map directly to DecompressionStream algorithm names. */
  const COMPRESSED_ENCODINGS = new Set(["deflate", "gzip", "deflate-raw"]);

  /**
   * Ensure currentRawBytes is populated for "raw"/"deflate"/"gzip"/"deflate-raw" encoding.
   * Uses the cached value when available (no re-decompression on zoom/pan).
   * Returns null when encoding is "png" (bitmap path used instead).
   * @param {Object} data
   * @returns {Promise<Uint8Array|null>}
   */
  async function ensureRawBytes(data) {
    if (currentRawBytes) { return currentRawBytes; }
    if (data.encoding === "png") { return null; }
    if (COMPRESSED_ENCODINGS.has(data.encoding)) {
      currentRawBytes = await decompress(data.b64Bytes, data.encoding);
    } else {
      // "raw" or undefined
      currentRawBytes = b64ToUint8Array(data.b64Bytes);
    }
    return currentRawBytes;
  }

  /**
   * Ensure currentBitmap is populated for "png" encoding.
   * Uses the cached value when available (no re-decode on zoom/pan).
   * Returns null for "raw"/"deflate" encoding.
   * @param {Object} data
   * @returns {Promise<ImageBitmap|null>}
   */
  async function ensureBitmap(data) {
    if (currentBitmap) { return currentBitmap; }
    if (data.encoding !== "png") { return null; }
    const bytes = b64ToUint8Array(data.b64Bytes);
    const blob = new Blob([bytes], { type: "image/png" });
    currentBitmap = await createImageBitmap(blob);
    return currentBitmap;
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
    renderImage(currentData).catch(console.error);
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
      renderImage(currentData).catch(console.error);
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

  /** Fit the image to the container and centre it. */
  function fitToWindow(data) {
    const container = canvas.parentElement;
    const cw = container.clientWidth  || data.width;
    const ch = container.clientHeight || data.height;
    zoom = Math.min(cw / data.width, ch / data.height);
    panX = (cw - data.width  * zoom) / 2;
    panY = (ch - data.height * zoom) / 2;
  }

  function resetView() {
    fitToWindow(currentData);
    renderImage(currentData).catch(console.error);
  }

  // ── Pixel Inspection ──────────────────────────────────────────────────────

  function getPixelValues(x, y) {
    if (currentData.encoding === "png") {
      // PNG path: sample one pixel from the cached bitmap via a 1×1 OffscreenCanvas.
      if (!currentBitmap) { return ""; }
      const tmp = new OffscreenCanvas(1, 1);
      const tc = tmp.getContext("2d");
      // drawImage with source-rect crops exactly one pixel from the bitmap.
      tc.drawImage(currentBitmap, x, y, 1, 1, 0, 0, 1, 1);
      const px = tc.getImageData(0, 0, 1, 1).data; // RGBA, each 0-255
      const ch = currentData.channels;
      if (ch === 1) { return `[${px[0]}]`; }
      if (ch === 4) { return `[${px[0]}, ${px[1]}, ${px[2]}, ${px[3]}]`; }
      return `[${px[0]}, ${px[1]}, ${px[2]}]`;
    }

    // raw / deflate path: read from the cached decoded bytes.
    if (!currentRawBytes) { return ""; }
    const typed = viewAsTyped(currentRawBytes, currentData.dtype);
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
      // Invalidate decode caches so the new data is decoded fresh.
      currentRawBytes = null;
      currentBitmap = null;
      normalize = !currentData.isUint8;
      chkNormalize.checked = normalize;
      swapBGR = (currentData.format === "BGR" || currentData.format === "BGRA");
      chkBGR.checked = swapBGR;
      const fmtStr = currentData.format ? `  ${currentData.format}` : "";
      infoLabel.textContent = `${currentData.height}×${currentData.width}  ch:${currentData.channels}  ${currentData.dtype}${fmtStr}`;
      fitToWindow(currentData);
      renderImage(currentData).catch(console.error);
    } else if (msg.type === "syncViewport") {
      zoom = msg.zoom;
      panX = msg.panX;
      panY = msg.panY;
      renderImage(currentData).catch(console.error);
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
