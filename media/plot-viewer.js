/**
 * plot-viewer.js — Front-end logic for the 1D Plot Viewer webview.
 *
 * Uses uPlot for fast canvas rendering.
 * Supports Line / Scatter / Histogram modes, save PNG / CSV, viewport sync.
 *
 * @typedef {import('../src/plot/plotProvider').PlotData} PlotData
 */

(function () {
  "use strict";

  const vscode = acquireVsCodeApi();

  /** @type {PlotData} */
  let data = window.__matrixViewer.initData;

  let plotInstance = null;
  let mode = "line";

  const selMode = document.getElementById("sel-mode");
  const statsLabel = document.getElementById("stats-label");
  const btnReset = document.getElementById("btn-reset");
  const btnSavePng = document.getElementById("btn-save-png");
  const btnSaveCsv = document.getElementById("btn-save-csv");
  const container = document.getElementById("plot-container");

  function init() {
    updateStats(data);
    buildPlot(data);

    selMode.addEventListener("change", () => {
      mode = selMode.value;
      buildPlot(data);
    });
    btnReset.addEventListener("click", () => buildPlot(data));
    btnSavePng.addEventListener("click", savePng);
    btnSaveCsv.addEventListener("click", saveCsv);
  }

  function updateStats(d) {
    const s = d.stats;
    statsLabel.textContent =
      `n=${d.length}  min=${s.min.toFixed(4)}  max=${s.max.toFixed(4)}  ` +
      `mean=${s.mean.toFixed(4)}  std=${s.std.toFixed(4)}`;
  }

  function buildPlot(d) {
    if (plotInstance) {
      plotInstance.destroy();
      container.innerHTML = "";
    }

    const xVals = d.xValues ?? Array.from({ length: d.yValues.length }, (_, i) => i);
    const yVals = d.yValues;

    if (mode === "histogram") {
      buildHistogram(xVals, yVals);
      return;
    }

    // uPlot series configuration
    const opts = {
      width: container.clientWidth || 800,
      height: container.clientHeight || 400,
      series: [
        {},
        {
          label: d.varName,
          stroke: "#4fc3f7",
          width: mode === "scatter" ? 0 : 1.5,
          points: { show: mode === "scatter", size: 4 },
        },
      ],
      axes: [
        { label: "Index", stroke: "#ccc", grid: { stroke: "#333" } },
        { label: d.varName, stroke: "#ccc", grid: { stroke: "#333" } },
      ],
      cursor: { drag: { setScale: true } },
      hooks: {
        setScale: [() => broadcastViewport()],
      },
    };

    plotInstance = new uPlot(opts, [xVals, yVals], container);
  }

  function buildHistogram(_, yVals) {
    const bins = 50;
    const min = Math.min(...yVals);
    const max = Math.max(...yVals);
    const step = (max - min) / bins || 1;
    const counts = new Array(bins).fill(0);
    for (const v of yVals) {
      const idx = Math.min(Math.floor((v - min) / step), bins - 1);
      counts[idx]++;
    }
    const binCenters = Array.from({ length: bins }, (_, i) => min + (i + 0.5) * step);

    const opts = {
      width: container.clientWidth || 800,
      height: container.clientHeight || 400,
      series: [
        {},
        { label: "count", fill: "rgba(79,195,247,0.4)", stroke: "#4fc3f7", paths: uPlot.paths.bars({ size: [0.9, 100] }) },
      ],
      axes: [
        { label: "Value", stroke: "#ccc" },
        { label: "Count", stroke: "#ccc" },
      ],
    };
    plotInstance = new uPlot(opts, [binCenters, counts], container);
  }

  function broadcastViewport() {
    if (!plotInstance) { return; }
    const sc = plotInstance.scales;
    vscode.postMessage({ type: "syncViewport", scalesX: sc.x, scalesY: sc.y });
  }

  function savePng() {
    if (!plotInstance) { return; }
    const canvas = container.querySelector("canvas");
    if (!canvas) { return; }
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.varName}_plot.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function saveCsv() {
    const rows = [["index", data.varName]];
    const xVals = data.xValues ?? data.yValues.map((_, i) => i);
    for (let i = 0; i < data.yValues.length; i++) {
      rows.push([xVals[i], data.yValues[i]]);
    }
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.varName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg.type === "update" && msg.data) {
      data = msg.data;
      updateStats(data);
      buildPlot(data);
    } else if (msg.type === "syncViewport" && plotInstance && msg.scalesX) {
      plotInstance.setScale("x", msg.scalesX);
    }
  });

  init();
})();
