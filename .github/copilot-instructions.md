# Matrix Viewer Debug — GitHub Copilot Instructions

## Project Overview

**Matrix Viewer Debug** is a Visual Studio Code extension (TypeScript) that visualizes 1D/2D/3D data structures during a debug session.

Inspired by [cv_debug_mate_cpp](https://github.com/dull-bird/cv_debug_mate_cpp).

### What it does

| Feature | Description |
|---------|-------------|
| **Variables Panel** | TreeView in the Debug sidebar that auto-detects visualizable variables (numpy arrays, PIL images, lists, etc.) in the current scope |
| **Image Viewer** | Renders PIL images / cv2 explicit types on a canvas; supports zoom, pan, colormap, normalize, hover pixel info, save PNG |
| **Plot Viewer** | 1D line/scatter chart or 2D scatter chart (when xValues provided) using uPlot; supports zoom/pan, stats, save PNG/CSV |
| **Point Cloud Viewer** | 3D point cloud with Three.js + OrbitControls; colour-by-axis, adjustable point size, save PLY |
| **View Sync** | Pair two open panels so their viewport (zoom/pan/rotation) stays in sync |
| **Auto Refresh** | All open panels refresh automatically when the debugger steps to a new line |

---

## Architecture

```
src/
├── extension.ts              # Entry point: command registration, debug events, visualization dispatch
├── mvVariablesProvider.ts    # TreeDataProvider for the Debug sidebar panel
├── adapters/                 # Language adapter layer
│   ├── IDebugAdapter.ts      # Shared interface: VariableInfo, VisualizableKind, IDebugAdapter
│   ├── ILibProviders.ts      # Per-library interfaces: ILibImageProvider, ILibPlotProvider, ILibPointCloudProvider
│   ├── adapterRegistry.ts    # Maps session.type → IDebugAdapter (first-match-wins)
│   ├── python/               # Python / debugpy / Jupyter adapter
│   │   ├── pythonDebugger.ts # DAP communication (evaluate, fetchArrayData, getVariablesInScope)
│   │   ├── pythonTypes.ts    # Pure type-detection functions (Layer 1 + Layer 2)
│   │   ├── imageProvider.ts  # Coordinator: delegates to first matching ILibImageProvider
│   │   ├── plotProvider.ts   # Coordinator: delegates to first matching ILibPlotProvider
│   │   ├── pointCloudProvider.ts # Coordinator: delegates to first matching ILibPointCloudProvider
│   │   ├── pythonAdapter.ts  # Implements IDebugAdapter, delegates to coordinators above
│   │   └── libs/             # Per-library provider implementations
│   │       ├── utils.ts      # Shared helpers (fetchArrayData wrappers, etc.)
│   │       ├── numpy/        # numpy.ndarray support (1D plot, Nx2 scatter, Nx3/Nx6 pointcloud)
│   │       │   ├── imageProvider.ts    # (kept for reference; not registered in image coordinator)
│   │       │   ├── plotProvider.ts
│   │       │   └── pointCloudProvider.ts
│   │       ├── pil/          # PIL.Image support
│   │       │   └── imageProvider.ts
│   │       ├── torch/        # torch.Tensor support
│   │       │   ├── imageProvider.ts
│   │       │   └── plotProvider.ts
│   │       ├── open3d/       # open3d.geometry.PointCloud support
│   │       │   └── pointCloudProvider.ts
│   │       └── builtins/     # Python built-in types (list, tuple, range)
│   │           ├── plotProvider.ts
│   │           └── pointCloudProvider.ts
│   └── cpp/                  # C++ / cppdbg / lldb adapter
│       ├── cppTypes.ts       # Layer-1 type detection (cv::Mat, Eigen, std::vector, pcl, C-arrays)
│       ├── cppDebugger.ts    # DAP communication (evaluate, readMemory, getVariablesInScope, etc.)
│       ├── cppAdapter.ts     # Implements IDebugAdapter, delegates to coordinators
│       ├── imageProvider.ts  # Coordinator: delegates to first matching ILibImageProvider
│       ├── plotProvider.ts   # Coordinator: delegates to first matching ILibPlotProvider
│       ├── pointCloudProvider.ts # Coordinator: delegates to first matching ILibPointCloudProvider
│       └── libs/             # Per-library provider implementations
│           ├── utils.ts      # Shared helpers (buffer, dtype, stats)
│           ├── opencv/       # cv::Mat support
│           │   ├── imageProvider.ts
│           │   └── matUtils.ts
│           ├── eigen/        # Eigen::Matrix (TODO)
│           │   └── plotProvider.ts
│           ├── pcl/          # pcl::PointCloud (TODO)
│           │   └── pointCloudProvider.ts
│           └── std/          # C++ standard library types
│               ├── stdUtils.ts          # Pure type-detection (std::vector, std::array, C-style arrays, Point3)
│               ├── plotProvider.ts      # std::vector<T>, std::array<T,N>, T[N] → PlotData
│               ├── imageProvider.ts     # 2D/3D std::array, T[H][W], T[H][W][C] → ImageData
│               └── pointCloudProvider.ts # std::vector<Point3f/d>, std::array<Point3f/d,N> → PointCloudData
├── viewers/
│   └── viewerTypes.ts        # Language-agnostic display data contracts (ImageData, PlotData, PointCloudData)
├── utils/
│   ├── panelManager.ts       # Webview panel lifecycle and refresh (uses IDebugAdapter)
│   └── syncManager.ts        # View sync pair state machine
├── matImage/
│   └── matWebview.ts         # Build HTML for the image viewer webview
├── plot/
│   └── plotWebview.ts        # Build HTML for the plot viewer webview
└── pointCloud/
    └── pointCloudWebview.ts  # Build HTML for the point cloud viewer webview

media/                        # Static front-end assets (served by webviews)
├── image-viewer.js / .css    # Canvas-based image rendering, zoom/pan logic
├── plot-viewer.js / .css     # uPlot wrapper
├── pointcloud-viewer.js/.css # Three.js point cloud scene
├── colormaps.js              # Colormap LUTs (gray, jet, viridis, hot, plasma)
├── uplot.iife.min.js         # uPlot chart library (vendored)
├── three.min.js              # Three.js (vendored)
└── OrbitControls.js          # Three.js OrbitControls (vendored)
```

### Key design patterns

- **Adapter pattern** — `IDebugAdapter` is the single interface the extension core depends on. Python (`PythonAdapter`) and C++ (`CppAdapter`) are separate implementations registered in `adapterRegistry.ts`. Adding a new language means implementing `IDebugAdapter` and adding one line to the registry.
- **Per-library provider pattern** — Each language adapter has a `libs/` subdirectory. Each third-party library (numpy, PIL, torch, opencv, eigen, pcl, open3d, …) implements one or more of `ILibImageProvider` / `ILibPlotProvider` / `ILibPointCloudProvider` from `adapters/ILibProviders.ts`. The coordinator files (`imageProvider.ts`, `plotProvider.ts`, `pointCloudProvider.ts`) iterate a `LIB_*_PROVIDERS` list and delegate to the first whose `canHandle()` returns true. **Adding a new library requires only creating one file in `libs/<libName>/` and appending it to the coordinator's list — no other files need changing.**
- **Language-agnostic viewer types** — `viewers/viewerTypes.ts` defines `ImageData`, `PlotData`, `PointCloudData`. All webview builders and `PanelManager` only depend on these types, never on language- or library-specific code.
- **Two-layer type detection** — `basicTypeDetect()` (fast string match) in the TreeView, `detectVisualizableType()` (shape + dtype) for visualization. Each adapter implements both layers independently.
- **DAP evaluate for Python** — All Python data is fetched via `debugSession.customRequest("evaluate", …)`. No memory reads. Small arrays → JSON (`tolist()`), large arrays → Base64 (`tobytes()`).
- **Webview CSP** — Every webview sets a strict Content-Security-Policy with a per-load nonce.
- **One panel per variable** — `PanelManager` deduplicates: clicking a variable that already has an open panel just focuses it.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension host | TypeScript 5, VS Code Extension API |
| Build | esbuild (bundle), tsc (type-check) |
| Webview UI | Vanilla JS + Canvas API (image), uPlot (plot), Three.js (point cloud) |
| Debug protocol | DAP via `vscode.DebugSession.customRequest` |
| Target debugger | Any language via `IDebugAdapter` — Python/debugpy built-in, C++ skeleton available |

---

## Coding Conventions

### TypeScript (src/)

- **Strict mode** always on (`"strict": true` in tsconfig).
- Prefer `const` / `let`; never `var`.
- Functions that can fail return `T | null` instead of throwing (let callers decide).
- Use `async/await`; avoid raw `.then()` chains.
- Name booleans with `is` / `has` / `can` prefix: `isUint8`, `hasPanel`.
- Export only what is needed by other modules — keep internals un-exported.
- `// ── Section ──` comments to separate logical blocks inside large files.
- No barrel re-exports (`index.ts`). Import directly from the source file.

### Module responsibilities (do not mix)

- `adapters/IDebugAdapter.ts` → **interface only**: `VariableInfo`, `VisualizableKind`, `IDebugAdapter`. No logic.
- `adapters/ILibProviders.ts` → **interface only**: `ILibImageProvider`, `ILibPlotProvider`, `ILibPointCloudProvider`. No logic.
- `adapters/adapterRegistry.ts` → registry lookup only; no data fetching.
- `adapters/<lang>/<lang>Types.ts` → **pure functions only**, no VS Code API, no `async`.
- `adapters/<lang>/<lang>Debugger.ts` → all DAP communication; no UI, no panel management.
- `adapters/<lang>/libs/<libName>/*Provider.ts` → implements one `ILib*Provider`; `canHandle()` + one `fetch*Data()`. Pure data fetching; never UI.
- `adapters/<lang>/*Provider.ts` (coordinators) → iterate `LIB_*_PROVIDERS`; delegate to first `canHandle()` match; return to language adapter.
- `viewers/viewerTypes.ts` → **plain data contracts only**; no logic, no imports.
- `*Webview.ts` → HTML string generation only; no data fetching.
- `panelManager.ts` → panel lifecycle + refresh via `IDebugAdapter`; no language-specific code.

### libs/ internal file placement rules

Every file inside `adapters/<lang>/libs/` must obey the following placement rules.
**Violating these rules is a bug — fix it before committing.**

#### `adapters/<lang>/libs/utils.ts` — cross-library shared utilities only

Put a function here **only if** it is used by two or more different `<libName>/` folders.
Allowed content:
- Buffer conversion helpers (`typedViewOf`, `bufferToBase64`, `typedBufferToNumbers`)
- Generic stats helpers (`computeMinMax`, `computeStats`, `computeBounds`)
- Shape helpers (`resolveHWC`)
- Dtype / depth conversion that is not tied to a specific library (`cvDepthToDtype`, `cppTypeToCvDepth`)

**Forbidden** in `libs/utils.ts`:
- Any type-detection logic specific to one library (e.g. `isMat`, `isPoint3Vector`)
- Any DAP communication (`session.customRequest`, `evaluateExpression`, etc.)
- Any function that only serves one `<libName>/` folder

#### `adapters/<lang>/libs/<libName>/` — library-specific code only

Every file inside a named library folder (`opencv/`, `numpy/`, `pil/`, `torch/`, `eigen/`, `pcl/`, `stl/`, etc.) must contain **only** code that is exclusive to that library.

| File | Allowed content |
|------|-----------------|
| `<libName>/imageProvider.ts` | `ILibImageProvider` implementation for this library only |
| `<libName>/plotProvider.ts` | `ILibPlotProvider` implementation for this library only |
| `<libName>/pointCloudProvider.ts` | `ILibPointCloudProvider` implementation for this library only |
| `<libName>/matUtils.ts` (or similar) | Helper types, interfaces, and functions **exclusive** to this library (e.g. `MatInfo`, `getMatInfoFromVariables` for OpenCV; `EigenInfo` for Eigen) |

**Forbidden** in a `<libName>/` file:
- Functions that are reusable across multiple libraries (move them to `libs/utils.ts`)
- DAP communication helpers that are not library-specific (move them to `<lang>Debugger.ts`)

#### Decision guide: where does this function belong?

```
Is the function used by more than one libName/ folder?
  YES → libs/utils.ts
  NO  →
    Is it DAP communication (customRequest, evaluate, readMemory)?
      YES →
        Is it specific to one library's data format (e.g. cv::Mat field layout)?
          YES → libs/<libName>/matUtils.ts (or equivalent)
          NO  → <lang>Debugger.ts
      NO  → libs/<libName>/ (whichever file matches its ILib* role)
```

#### Concrete examples (C++ adapter)

| Function / Type | Correct location |
|-----------------|-----------------|
| `getBytesPerElement`, `bufferToBase64`, `computeStats` | `libs/utils.ts` |
| `cvDepthToDtype`, `cppTypeToCvDepth` | `libs/utils.ts` |
| `MatInfo`, `getMatInfoFromVariables`, `getMatInfoFromEvaluate` | `libs/opencv/matUtils.ts` |
| `OpenCvImageProvider` (implements `ILibImageProvider`) | `libs/opencv/imageProvider.ts` |
| `isBasicNumericType`, `is1DVector`, `is2DStdArray`, `isPoint3Vector` | `libs/std/stdUtils.ts` |
| `StdPlotProvider`, `StdImageProvider`, `StdPointCloudProvider` | `libs/std/*Provider.ts` |
| `EigenPlotProvider` (`evalEigenDim`, `getEigenDataPointer` as private helpers) | `libs/eigen/plotProvider.ts` |
| `PclPointCloudProvider` | `libs/pcl/pointCloudProvider.ts` |
| `isValidMemoryReference`, `readMemoryChunked`, `getCurrentFrameId`, `getContainerSize` | `cppDebugger.ts` |
| `build2DDataPointerExpressions`, `build3DDataPointerExpressions` | `cppDebugger.ts` |

### Front-end JS (media/)

- Vanilla JS, no TypeScript, no bundler — files are served directly.
- Each file is an IIFE `(function() { … })()`.
- Communicate with the extension host only via `vscode.postMessage()` and `window.addEventListener("message", …)`.
- Incoming messages from the extension: `{ type: "update", data }` and `{ type: "syncViewport", … }`.
- Outgoing messages to the extension: `{ type: "syncViewport", … }`.

### Security

- All webviews must set a `Content-Security-Policy` meta tag with a random nonce.
- Never inject unsanitised variable names or data into HTML template strings directly. Use `JSON.stringify` for data blobs.
- Debug evaluations run Python code inside the user's debug session (expected). Never evaluate expressions from untrusted sources.

---

## Common Tasks for Copilot

### Add support for a new library (e.g. open3d for Python, or PCL for C++)

1. Create `src/adapters/<lang>/libs/<libName>/imageProvider.ts` (and/or `plotProvider.ts`, `pointCloudProvider.ts`).
2. Implement `ILibImageProvider` / `ILibPlotProvider` / `ILibPointCloudProvider` from `src/adapters/ILibProviders.ts`.
   - `canHandle(typeName)` — return `true` for the type strings this library produces.
   - `fetch*Data(session, varName, info)` — fetch and return the typed data object.
3. Append a new instance to `LIB_IMAGE_PROVIDERS` (etc.) in the coordinator `src/adapters/<lang>/imageProvider.ts`.
4. Add type-name patterns to `<lang>Types.ts` so Layer-1 quick detection recognises the new type.
5. **Tests** — add a unit test in `src/test/`.

### Add support for a new language (e.g. Rust, Java)

1. Create `src/adapters/<lang>/` directory with:
   - `<lang>Types.ts` — Layer-1 type detection from DAP type strings (pure functions).
   - `<lang>Adapter.ts` — Implements `IDebugAdapter`. Coordinator `fetch*Data` methods delegate to `libs/`.
   - `libs/<libName>/*Provider.ts` — per-library implementations of `ILib*Provider`.
2. Register the new adapter in `src/adapters/adapterRegistry.ts` by appending to `ADAPTERS`.
3. Implement `isSupportedSession()` to match the correct `session.type` strings.

### Add support for a new Python type in an existing library

1. **`src/adapters/python/libs/<libName>/imageProvider.ts`** (or `plotProvider.ts` / `pointCloudProvider.ts`) — add or extend the `fetch*Data` implementation.
2. **`src/adapters/python/pythonTypes.ts`** — add a pattern to `IMAGE_TYPE_PATTERNS`, `PLOT_TYPE_PATTERNS`, or `POINTCLOUD_TYPE_PATTERNS` so Layer-1 detection recognises it.
3. **Tests** — add a unit test in `src/test/`.

### Add a new webview control (e.g. a slider)

1. Add the HTML element to the `/* html */` template string in `*Webview.ts`.
2. Add the event listener in the corresponding `media/*.js` IIFE.
3. If the control affects data (not just rendering), post a message to the extension host and handle it in `panelManager.ts`.

### Add a new command

1. Declare it in `package.json` under `contributes.commands`.
2. Add it to the appropriate `contributes.menus` entry.
3. Register it with `vscode.commands.registerCommand` in `extension.ts`.

---

## Testing

- Unit tests live in `src/test/` and use the `@vscode/test-electron` runner.
- Type-detection functions (`pythonTypes.ts`) are pure and should have high coverage.
- DAP interactions are tested with a mocked `vscode.DebugSession`.
- Run: `npm test`

---

## Build & Run

```bash
npm install          # install dependencies
npm run compile      # type-check + bundle (dist/extension.js)
npm run watch        # incremental watch mode (for development)
# Press F5 in VS Code to launch a new Extension Development Host
```

Vendored libraries (`three.min.js`, `uplot.iife.min.js`, `OrbitControls.js`) must be downloaded and placed in `media/` before the extension can run. See `docs/setup.md` for details.
