# Setup Guide — CV DebugMate Python

## Prerequisites

- Node.js ≥ 20
- VS Code 1.93+
- A Python environment with `debugpy` (installed automatically by the Python extension)

## 1. Install dependencies

```bash
cd cv_debug_mate_python
npm install
```

## 2. Download vendored front-end libraries

These files are not committed to the repo. Download them and place in `media/`:

| File | Source |
|------|--------|
| `media/uplot.iife.min.js` | https://cdn.jsdelivr.net/npm/uplot/dist/uPlot.iife.min.js |
| `media/three.min.js` | https://cdn.jsdelivr.net/npm/three/build/three.min.js |
| `media/OrbitControls.js` | https://cdn.jsdelivr.net/npm/three/examples/js/controls/OrbitControls.js |

One-liner:

```bash
cd media
curl -O https://cdn.jsdelivr.net/npm/uplot/dist/uPlot.iife.min.js
curl -O https://cdn.jsdelivr.net/npm/three/build/three.min.js
curl -O https://cdn.jsdelivr.net/npm/three/examples/js/controls/OrbitControls.js
```

## 3. Build

```bash
npm run compile   # type-check + bundle → dist/extension.js
```

Or start incremental watch mode during development:

```bash
npm run watch
```

## 4. Launch the Extension Development Host

Press **F5** in VS Code (or use the `Run Extension` launch configuration).

A new VS Code window opens with the extension loaded. Open a Python file and start debugging.

## 5. Run tests

```bash
npm test
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Panel shows nothing | Make sure a Python debug session is active and paused at a breakpoint |
| "Cannot resolve variable" | The variable may be out of scope; step to the right frame |
| Image shows as noise | Toggle **Auto Normalize** — float arrays need normalisation |
| Large array hangs | Increase `cvDebugMate.largeDataThresholdMB` or reduce array size |
