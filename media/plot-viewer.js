/**
 * plot-viewer.js — Front-end logic for the 1D Plot Viewer webview.
 *
 * Line / Scatter modes: Canvas2D (no third-party dependency, reliable in VS Code WebView).
 * Histogram mode: uPlot bar chart.
 * Supports zoom/pan (wheel + drag), save PNG / CSV.
 */

(function () {
  "use strict";

  const vscode = acquireVsCodeApi();

  /** @type {import('../src/viewers/viewerTypes').PlotData} */
  let data = window.__matrixViewer.initData;

  let mode = data.xValues ? "scatter" : "line";

  // Histogram configuration state
  let histConfig = { type: "bins", bins: 50, step: null };

  // Current zoom/pan view range; null = auto-fit from data
  let viewRange = null;

  const selMode       = document.getElementById("sel-mode");
  const statsLabel    = document.getElementById("stats-label");
  const btnReset      = document.getElementById("btn-reset");
  const btnHistConfig = document.getElementById("btn-hist-config");
  const btnSavePng    = document.getElementById("btn-save-png");
  const btnSaveCsv    = document.getElementById("btn-save-csv");
  const container     = document.getElementById("plot-container");

  // Layout padding constants (pixels)
  const PAD = { L: 64, R: 20, T: 20, B: 40 };

  // ── Init ────────────────────────────────────────────────────────────────────

  function init() {
    selMode.value = mode;
    updateConfigBtnVisibility();
    updateStats(data);

    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => buildPlot(data)).observe(container);
    } else {
      setTimeout(() => buildPlot(data), 0);
    }

    selMode.addEventListener("change", () => {
      mode = selMode.value;
      viewRange = null;
      updateConfigBtnVisibility();
      buildPlot(data);
    });
    btnReset.addEventListener("click", () => {
      viewRange = null;
      if (mode === "histogram") {
        histConfig = { type: "bins", bins: 50, step: null };
      }
      buildPlot(data);
    });
    btnHistConfig.addEventListener("click", openHistConfigModal);
    btnSavePng.addEventListener("click", savePng);
    btnSaveCsv.addEventListener("click", saveCsv);
  }

  function updateConfigBtnVisibility() {
    btnHistConfig.style.display = mode === "histogram" ? "" : "none";
  }

  function updateStats(d) {
    const s = d.stats;
    statsLabel.textContent =
      `n=${d.length}  min=${s.min.toFixed(4)}  max=${s.max.toFixed(4)}  ` +
      `mean=${s.mean.toFixed(4)}  std=${s.std.toFixed(4)}`;
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────────

  function buildPlot(d) {
    container.innerHTML = "";

    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w <= 0 || h <= 0) { return; }

    const xVals = d.xValues ?? Array.from({ length: d.yValues.length }, (_, i) => i);
    const yVals = d.yValues;

    console.log("[PlotViewer] buildPlot:", d.varName,
      "n:", yVals.length, "size:", w, "x", h,
      "mode:", mode, "range:", d.stats.min, "-", d.stats.max);

    if (mode === "histogram") {
      buildHistogram(yVals, w, h);
    } else {
      buildCanvas2D(xVals, yVals, d, w, h);
    }
  }

  // ── Canvas2D line / scatter renderer ─────────────────────────────────────────

  function buildCanvas2D(xVals, yVals, d, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width  = width;
    canvas.height = height;
    canvas.style.display = "block";
    canvas.style.cursor  = "crosshair";
    container.appendChild(canvas);

    if (!viewRange) {
      const isXY = !!d.xValues;
      const xMin0 = isXY ? Math.min(...xVals) : xVals[0];
      const xMax0 = isXY ? Math.max(...xVals) : xVals[xVals.length - 1];
      const xPad  = isXY ? ((xMax0 - xMin0) * 0.1 || Math.abs(xMax0) * 0.1 || 0.5) : 0;
      const yPad  = (d.stats.max - d.stats.min) * 0.1 || Math.abs(d.stats.max) * 0.1 || 0.5;
      viewRange = {
        xMin: xMin0 - xPad, xMax: xMax0 + xPad,
        yMin: d.stats.min - yPad,
        yMax: d.stats.max + yPad,
      };
    }

    drawCanvas2D(canvas, xVals, yVals, d);
    attachCanvasInteraction(canvas, xVals, yVals, d);
  }

  function drawCanvas2D(canvas, xVals, yVals, d) {
    const varName = d.varName;
    const W = canvas.width, H = canvas.height;
    const { L, R, T, B } = PAD;
    const pw = W - L - R;
    const ph = H - T - B;
    const ctx = canvas.getContext("2d");

    // Background
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(0, 0, W, H);

    const { xMin, xMax, yMin, yMax } = viewRange;
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;
    const sx = x => L + (x - xMin) / xRange * pw;
    const sy = y => T + ph - (y - yMin) / yRange * ph;

    const TICKS = 6;

    // Grid
    ctx.strokeStyle = "#2e2e2e";
    ctx.lineWidth = 1;
    for (let i = 0; i <= TICKS; i++) {
      const gy = T + i * ph / TICKS;
      ctx.beginPath(); ctx.moveTo(L, gy); ctx.lineTo(L + pw, gy); ctx.stroke();
      const gx = L + i * pw / TICKS;
      ctx.beginPath(); ctx.moveTo(gx, T); ctx.lineTo(gx, T + ph); ctx.stroke();
    }

    // Zero line
    if (yMin < 0 && yMax > 0) {
      ctx.strokeStyle = "#555"; ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(L, sy(0)); ctx.lineTo(L + pw, sy(0)); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Axes
    ctx.strokeStyle = "#888"; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L, T); ctx.lineTo(L, T + ph); ctx.lineTo(L + pw, T + ph);
    ctx.stroke();

    // Y tick labels
    ctx.fillStyle = "#888"; ctx.font = "11px monospace";
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let i = 0; i <= TICKS; i++) {
      ctx.fillText(fmtTick(yMax - i * yRange / TICKS), L - 6, T + i * ph / TICKS);
    }

    // X tick labels
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let i = 0; i <= TICKS; i++) {
      ctx.fillText(fmtTick(xMin + i * xRange / TICKS), L + i * pw / TICKS, T + ph + 6);
    }

    // Axis name labels
    ctx.fillStyle = "#ccc"; ctx.font = "12px monospace"; ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(d.xValues ? "X" : "Index", L + pw / 2, H);
    ctx.save();
    ctx.translate(12, T + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "top"; ctx.fillText(varName, 0, 0);
    ctx.restore();

    // Data (clipped to plot area)
    ctx.save();
    ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();

    if (mode === "scatter") {
      ctx.fillStyle = "#4fc3f7";
      for (let i = 0; i < xVals.length; i++) {
        ctx.beginPath();
        ctx.arc(sx(xVals[i]), sy(yVals[i]), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = "#4fc3f7"; ctx.lineWidth = 1.5; ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(sx(xVals[0]), sy(yVals[0]));
      for (let i = 1; i < xVals.length; i++) {
        ctx.lineTo(sx(xVals[i]), sy(yVals[i]));
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function fmtTick(v) {
    if (v === 0) { return "0"; }
    const a = Math.abs(v);
    if (a >= 0.001 && a < 10000) { return v.toFixed(a < 1 ? 4 : a < 100 ? 2 : 1); }
    return v.toPrecision(3);
  }

  // ── Zoom / Pan ────────────────────────────────────────────────────────────────

  function attachCanvasInteraction(canvas, xVals, yVals, d) {
    const varName = d.varName;
    const isXY = !!d.xValues;
    let tooltipEl = null;

    // Wheel zoom
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect   = canvas.getBoundingClientRect();
      const mx     = (e.clientX - rect.left  - PAD.L) / (canvas.width  - PAD.L - PAD.R);
      const my     = 1 - (e.clientY - rect.top - PAD.T) / (canvas.height - PAD.T - PAD.B);
      const scale  = e.deltaY < 0 ? 0.8 : 1 / 0.8;
      const { xMin, xMax, yMin, yMax } = viewRange;
      const xPivot = xMin + mx * (xMax - xMin);
      const yPivot = yMin + my * (yMax - yMin);
      viewRange = {
        xMin: xPivot - (xPivot - xMin) * scale,
        xMax: xPivot + (xMax - xPivot) * scale,
        yMin: yPivot - (yPivot - yMin) * scale,
        yMax: yPivot + (yMax - yPivot) * scale,
      };
      drawCanvas2D(canvas, xVals, yVals, d);
    }, { passive: false });

    // Drag pan
    let dragging = false, dragStart = null, rangeSave = null;
    canvas.addEventListener("mousedown", (e) => {
      dragging  = true;
      dragStart = { x: e.clientX, y: e.clientY };
      rangeSave = { ...viewRange };
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) { return; }
      const pw = canvas.width  - PAD.L - PAD.R;
      const ph = canvas.height - PAD.T - PAD.B;
      const dx = (e.clientX - dragStart.x) / pw * (rangeSave.xMax - rangeSave.xMin);
      const dy = (e.clientY - dragStart.y) / ph * (rangeSave.yMax - rangeSave.yMin);
      viewRange = {
        xMin: rangeSave.xMin - dx, xMax: rangeSave.xMax - dx,
        yMin: rangeSave.yMin + dy, yMax: rangeSave.yMax + dy,
      };
      drawCanvas2D(canvas, xVals, yVals, d);
    });
    window.addEventListener("mouseup", () => { dragging = false; });

    // Hover tooltip
    canvas.addEventListener("mousemove", (e) => {
      if (dragging) { return; }
      const rect   = canvas.getBoundingClientRect();
      const px     = e.clientX - rect.left - PAD.L;
      const py     = e.clientY - rect.top  - PAD.T;
      const pw     = canvas.width  - PAD.L - PAD.R;
      const ph     = canvas.height - PAD.T - PAD.B;
      const xHover = viewRange.xMin + (px / pw) * (viewRange.xMax - viewRange.xMin);
      const yHover = viewRange.yMax - (py / ph) * (viewRange.yMax - viewRange.yMin);
      const xRange = viewRange.xMax - viewRange.xMin || 1;
      const yRange = viewRange.yMax - viewRange.yMin || 1;
      let best = 0, bestDist = Infinity;
      for (let i = 0; i < xVals.length; i++) {
        const dx = (xVals[i] - xHover) / xRange;
        const dy = (yVals[i] - yHover) / yRange;
        const dist = isXY ? Math.hypot(dx, dy) : Math.abs(dx);
        if (dist < bestDist) { bestDist = dist; best = i; }
      }
      if (!tooltipEl) {
        tooltipEl = document.createElement("div");
        tooltipEl.style.cssText =
          "position:fixed;background:rgba(0,0,0,.8);color:#fff;" +
          "padding:3px 7px;font:11px monospace;pointer-events:none;border-radius:3px;z-index:200;";
        document.body.appendChild(tooltipEl);
      }
      tooltipEl.style.display = "block";
      tooltipEl.textContent   = isXY
        ? `(${xVals[best].toPrecision(5)}, ${yVals[best].toPrecision(5)})`
        : `[${xVals[best]}]  ${yVals[best].toPrecision(6)}`;
      tooltipEl.style.left    = `${e.clientX + 12}px`;
      tooltipEl.style.top     = `${e.clientY  -  4}px`;
    });
    canvas.addEventListener("mouseleave", () => {
      if (tooltipEl) { tooltipEl.style.display = "none"; }
    });
  }

  // ── Histogram Config Modal ────────────────────────────────────────────────

  function openHistConfigModal() {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:500;" +
      "display:flex;align-items:center;justify-content:center;";

    const stepDefault = histConfig.step != null
      ? histConfig.step
      : (data.stats.max - data.stats.min) / histConfig.bins || 1;

    const box = document.createElement("div");
    box.style.cssText =
      "background:#252526;border:1px solid #555;border-radius:6px;" +
      "padding:16px 20px;min-width:260px;font:13px monospace;color:#ccc;";
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <strong>Histogram Config</strong>
        <button id="hist-cfg-close" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;line-height:1;padding:0 4px">&times;</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <label style="display:flex;align-items:center;gap:8px">
          <input type="radio" name="hist-type" value="bins" ${histConfig.type === "bins" ? "checked" : ""}>
          Bin count
          <input type="number" id="hist-bins-val" min="1" max="500" value="${histConfig.bins}"
            style="width:72px;margin-left:auto;background:#3c3c3c;border:1px solid #555;color:#ccc;padding:2px 6px;border-radius:3px">
        </label>
        <label style="display:flex;align-items:center;gap:8px">
          <input type="radio" name="hist-type" value="step" ${histConfig.type === "step" ? "checked" : ""}>
          Bin size
          <input type="number" id="hist-step-val" min="0" step="any" value="${fmtTick(stepDefault)}"
            style="width:72px;margin-left:auto;background:#3c3c3c;border:1px solid #555;color:#ccc;padding:2px 6px;border-radius:3px">
        </label>
      </div>
      <div style="margin-top:14px;font-size:11px;color:#888">Close or press Esc to apply</div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function applyAndClose() {
      const type     = box.querySelector("input[name='hist-type']:checked")?.value || "bins";
      const binsVal  = parseInt(box.querySelector("#hist-bins-val").value, 10);
      const stepVal  = parseFloat(box.querySelector("#hist-step-val").value);
      histConfig = {
        type,
        bins: (isNaN(binsVal) || binsVal < 1) ? 50 : Math.min(binsVal, 500),
        step: (isNaN(stepVal) || stepVal <= 0) ? null : stepVal,
      };
      document.body.removeChild(overlay);
      buildPlot(data);
    }

    box.querySelector("#hist-cfg-close").addEventListener("click", applyAndClose);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) { applyAndClose(); } });
    const onKey = (e) => { if (e.key === "Escape") { document.removeEventListener("keydown", onKey); applyAndClose(); } };
    document.addEventListener("keydown", onKey);
  }

  // ── Histogram (Canvas2D) ───────────────────────────────────────────────────

  function buildHistogram(yVals, width, height) {
    const lo = Math.min(...yVals);
    const hi = Math.max(...yVals);
    let step, BINS;
    if (histConfig.type === "step" && histConfig.step != null) {
      step = histConfig.step;
      BINS = Math.max(1, Math.ceil((hi - lo) / step));
    } else {
      BINS = histConfig.bins;
      step = (hi - lo) / BINS || 1;
    }
    const counts = new Array(BINS).fill(0);
    for (const v of yVals) {
      counts[Math.min(Math.floor((v - lo) / step), BINS - 1)]++;
    }
    const maxCount = Math.max(...counts);
    // Add 15% headroom so the tallest bar never touches the top of the plot area
    const yAxisMax = Math.ceil(maxCount * 1.15) || 1;

    const canvas = document.createElement("canvas");
    canvas.width  = width;
    canvas.height = height;
    canvas.style.display = "block";
    container.appendChild(canvas);

    const { L, R, T, B } = PAD;
    const pw  = width  - L - R;
    const ph  = height - T - B;
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(0, 0, width, height);

    // Grid
    const YTICKS = 6;
    ctx.strokeStyle = "#2e2e2e"; ctx.lineWidth = 1;
    for (let i = 0; i <= YTICKS; i++) {
      const gy = T + i * ph / YTICKS;
      ctx.beginPath(); ctx.moveTo(L, gy); ctx.lineTo(L + pw, gy); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = "#888"; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L, T); ctx.lineTo(L, T + ph); ctx.lineTo(L + pw, T + ph);
    ctx.stroke();

    // Bars
    const barW = pw / BINS;
    ctx.fillStyle   = "rgba(79,195,247,0.4)";
    ctx.strokeStyle = "#4fc3f7";
    ctx.lineWidth   = 1;
    for (let i = 0; i < BINS; i++) {
      const barH = counts[i] / yAxisMax * ph;
      const bx   = L + i * barW;
      const by   = T + ph - barH;
      ctx.fillRect(bx, by, barW - 1, barH);
      ctx.strokeRect(bx, by, barW - 1, barH);
    }

    // Y tick labels (counts)
    ctx.fillStyle = "#888"; ctx.font = "11px monospace";
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let i = 0; i <= YTICKS; i++) {
      const val = Math.round(yAxisMax * (1 - i / YTICKS));
      ctx.fillText(val, L - 6, T + i * ph / YTICKS);
    }

    // X tick labels (values)
    const XTICKS = 6;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let i = 0; i <= XTICKS; i++) {
      const val = lo + i * (hi - lo) / XTICKS;
      ctx.fillText(fmtTick(val), L + i * pw / XTICKS, T + ph + 6);
    }

    // Axis name labels
    ctx.fillStyle = "#ccc"; ctx.font = "12px monospace"; ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("Value", L + pw / 2, height);
    ctx.save();
    ctx.translate(12, T + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "top"; ctx.fillText("Count", 0, 0);
    ctx.restore();

    // Hover tooltip
    let tooltipEl = null;
    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const px   = e.clientX - rect.left - L;
      const bin  = Math.floor(px / barW);
      if (bin < 0 || bin >= BINS) {
        if (tooltipEl) { tooltipEl.style.display = "none"; }
        return;
      }
      if (!tooltipEl) {
        tooltipEl = document.createElement("div");
        tooltipEl.style.cssText =
          "position:fixed;background:rgba(0,0,0,.8);color:#fff;" +
          "padding:3px 7px;font:11px monospace;pointer-events:none;border-radius:3px;z-index:200;";
        document.body.appendChild(tooltipEl);
      }
      const binLo = lo + bin * step;
      const binHi = binLo + step;
      tooltipEl.style.display = "block";
      tooltipEl.textContent   = `[${fmtTick(binLo)}, ${fmtTick(binHi)})  count: ${counts[bin]}`;
      tooltipEl.style.left    = `${e.clientX + 12}px`;
      tooltipEl.style.top     = `${e.clientY  -  4}px`;
    });
    canvas.addEventListener("mouseleave", () => {
      if (tooltipEl) { tooltipEl.style.display = "none"; }
    });
  }

  // ── Save helpers ───────────────────────────────────────────────────────────

  function savePng() {
    const canvas = container.querySelector("canvas");
    if (!canvas) { return; }
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${data.varName}_plot.png`; a.click();
      URL.revokeObjectURL(url);
    });
  }

  function saveCsv() {
    const rows  = [["index", data.varName]];
    const xVals = data.xValues ?? data.yValues.map((_, i) => i);
    for (let i = 0; i < data.yValues.length; i++) {
      rows.push([xVals[i], data.yValues[i]]);
    }
    const csv  = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${data.varName}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Message bus ───────────────────────────────────────────────────────────

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg.type === "update" && msg.data) {
      data      = msg.data;
      viewRange = null;
      updateStats(data);
      buildPlot(data);
    }
  });

  init();
})();
