# MatrixViewer Debug 需求文档

> 参考项目: [cv_debug_mate_cpp](https://github.com/dull-bird/cv_debug_mate_cpp)  
> VS Code 调试可视化扩展，在调试过程中可视化 1/2/3D 数据结构。
> 目前支持 **Python**（debugpy）和 **C++**（GDB / vsdbg / CodeLLDB）。

---

## 一、核心功能概览

| 功能模块 | C++ 版 | Python 版对应 |
|---------|--------|--------------|
| **1D 曲线图** | `std::vector<T>`, `std::array<T,N>`, `T[N]`, `std::set<T>`, `Eigen::VectorX*`, `Eigen::Matrix<T,N,1>`, `QVector<T>`, `QList<T>` | `list`, `tuple`, `np.ndarray` (1D), `array.array` |
| **2D 散点图** | `Eigen::Matrix<T,N,2>` (N×2，列0=X，列1=Y), `QPolygonF`, `QVector<QVector2D>` | `np.ndarray` (N,2), `list` of 2-tuples |
| **2D 图像** | `cv::Mat`, `T[H][W]`, `std::array<std::array<T>>`, `Eigen::Matrix<T,R,C>` (rows>1, cols>2), `QImage` | `PIL.Image`, `torch.Tensor` (2D/3D/4D), `cv2.UMat`/`GpuMat` |
| **3D 点云** | `std::vector<cv::Point3f>`, `QVector<QVector3D>` | `np.ndarray` (N,3/6), `list` of 3-tuples, `open3d.geometry.PointCloud` |
| **变量面板** | TreeView 自动检测当前作用域变量 | TreeView 自动检测当前作用域变量 |
| **视图同步** | 配对变量联动缩放/平移 | 配对变量联动缩放/平移 |
| **自动刷新** | 单步调试自动更新 | 单步调试自动更新 |

---

## 二、支持的数据类型

### 2.1 图像类型（2D Viewer）

| 类型 | 说明 | 备注 |
|------|------|------|
| `PIL.Image.Image` | PIL/Pillow 图像 | 已实现 |
| `torch.Tensor` shape `(H, W)` | 灰度图（需 detach/cpu） | 已实现 |
| `torch.Tensor` shape `(C, H, W)` 或 `(H, W, C)` | 多通道图（需 detach/cpu） | 已实现 |
| `cv2.UMat` | OpenCV UMat（CPU 透明 API） | 已实现 |
| `cv2.cuda.GpuMat` | OpenCV GPU 矩阵 | 已实现 |
| `Eigen::Matrix<T,R,C>` / `Eigen::Array<T,R,C>` (rows>1, cols>2) | 单通道灰度图（自动开启归一化） | 已实现 |
| `QImage` (Qt5 / Qt6) | Qt 图像，支持 Format_Grayscale8 / RGB32 / ARGB32 / RGB888 等格式，兼容 Qt5 (`byteCount()`) 和 Qt6 (`sizeInBytes()`) | 计划中 |
| `sensor_msgs::msg::Image` (ROS 2) | ROS 2 图像消息，支持 mono8 / mono16 / rgb8 / bgr8 / rgba8 / bgra8 / 8UCx / 32FCx 等编码（自动按 step 去 padding）| 已实现（仅 GDB / cppdbg） |

> **注意**：`numpy.ndarray` 不再作为图像类型直接可视化。  
> 如需将 numpy 图像数据可视化，请使用 `PIL.Image.fromarray()` 或 `cv2.UMat()` 包装。

### 2.2 曲线类型（1D/2D Plot Viewer）

| 类型 | 可视化模式 | 说明 |
|------|----------|------|
| `np.ndarray` shape `(N,)` | 1D 折线图 | 已实现 |
| `np.ndarray` shape `(N, 2)` | 2D 散点图 (col-0=X, col-1=Y) | 已实现 |
| `list` / `tuple` of scalars | 1D 折线图 | 已实现 |
| `list` / `tuple` of 2-element seqs | 2D 散点图 | 已实现 |
| `array.array` | 1D 折线图 | 已实现 |
| `torch.Tensor` shape `(N,)` | 1D 折线图 | 已实现 |
| `range` | 1D 折线图 | 已实现 |
| `Eigen::VectorX*` / `Eigen::RowVectorX*` | 1D 折线图 | 已实现 |
| `Eigen::Matrix<T,N,1>` 或 `Eigen::Matrix<T,1,N>` | 1D 折线图 | 已实现 |
| `Eigen::Matrix<T,N,2>` (N×2，列0=X，列1=Y) | 2D 散点图 | 已实现 |
| `QVector<T>` / `QList<T>`（T 为数值类型，Qt5/Qt6）| 1D 折线图；Qt6 中 `QVector` = `QList`，类型字符串两者均需匹配 | 计划中 |
| `QPolygonF`（= `QList<QPointF>`） | 2D 散点图（x=QPointF.x, y=QPointF.y） | 计划中 |
| `QVector<QVector2D>` / `QList<QVector2D>` | 2D 散点图（x=x(), y=y()） | 计划中 |

> **Eigen 路由规则**（Layer-2 运行时检测，查询 `.rows()` / `.cols()`）：
>
> | 条件 | 可视化类型 |
> |------|----------|
> | `cols == 1` 或 `rows == 1` | 1D 折线图 |
> | `cols == 2` | 2D 散点图（Eigen 列优先存储：X = 第0列，Y = 第1列）|
> | `rows > 1` 且 `cols > 2` | 图像（单通道灰度，自动归一化）|

### 2.3 点云类型（3D Point Cloud Viewer）

| 类型 | 说明 | 状态 |
|------|------|------|
| `np.ndarray` shape `(N, 3)` | XYZ 点云，dtype: float32/float64 | 已实现 |
| `np.ndarray` shape `(N, 6)` | XYZ + RGB 点云 | 已实现 |
| `list` / `tuple` of 3-element seqs | 点云列表 | 已实现 |
| `open3d.geometry.PointCloud` | open3d 点云（含可选颜色） | 已实现 |
| `QVector<QVector3D>`（Qt5/Qt6）| XYZ 点云（x=x(), y=y(), z=z()） | 计划中 |
| `sensor_msgs::msg::PointCloud2` (ROS 2) | ROS 2 点云消息，按 PointField 偏移解析 x/y/z (FLOAT32)，可选 rgb/rgba（PCL 字节序 BGRA） | 已实现（仅 GDB / cppdbg） |

---

## 三、功能特性详细需求

### 3.1 变量自动检测面板（Variables Panel）

- 在 VS Code **调试侧边栏** 注册 TreeView，显示当前作用域所有**可视化的变量**
- 通过 Python 调试器（debugpy）接口，使用 DAP（Debug Adapter Protocol）获取当前帧的变量列表
- 对每个变量执行类型判断：
  - 基础检测：通过变量的 `type` 字符串快速分类（不依赖调试器求值，速度快）
  - 增强检测：通过 `evaluate` 命令获取 `type(var).__name__`、`var.shape`、`var.dtype` 等信息精确分类
- 变量按类型分组展示（图像组、曲线组、点云组）
- 支持**手动添加变量**到面板（右键菜单 → "Add to MatrixViewer"）
- 支持**变量分组**（Add to Group）

### 3.1.1 编辑器右键可视化（Editor Context Menu）

- 调试暂停时，在代码编辑器中将光标置于某变量名上，右键菜单出现 **"Visualize by MatrixViewer"** 选项
- 仅当光标所在单词存在于当前调试作用域的可视化变量集合中时，右键项才会显示
- 通过上下文键 `matrixViewer.canVisualizeSelection` 动态控制菜单可见性
- 通过配置项 `matrixViewer.editorContextMenu`（默认 `true`）可关闭此功能
- 源码：`src/extension.ts`（命令 `matrixViewer.visualizeSelection`、选区监听、上下文键更新）

### 3.2 2D 图像查看器（Image Viewer）

- 显示图像内容，支持多通道（灰度/RGB/BGR/RGBA）
- **交互操作**：
  - 滚轮缩放（最大 100×）
  - 拖动平移
  - Reset 按钮重置视图
- **功能控件**：
  - 自动归一化（Auto Normalize）：将数据范围映射到 [0, 255]，适用于 float 型数据
  - 伪彩色映射（Colormap）：可选灰度/热力图/Jet 等
  - 通道切换（BGR↔RGB，单通道显示等）
  - 导出：Save PNG / TIFF
- **悬停信息**：鼠标悬停时显示像素坐标和像素值
- **图像尺寸信息**：显示 `HxW (C channels, dtype)`

### 3.3 1D 曲线查看器（Plot Viewer）

- 支持折线图（Line）、散点图（Scatter）、直方图（Histogram）3 种模式
- **自定义 X 轴**：可指定另一个变量作为 X 轴数据
- **交互操作**：
  - 框选缩放
  - 滚轮缩放
  - 拖动平移
  - 双击 / Reset 重置视图
- **导出**：Save PNG / CSV
- 显示数据统计信息（最小值、最大值、均值、标准差）

### 3.4 3D 点云查看器（Point Cloud Viewer）

- 基于 Three.js 在 Webview 中渲染
- **交互操作**：
  - 鼠标拖动旋转
  - 滚轮缩放
- **功能控件**：
  - 按 X/Y/Z 轴着色（颜色映射）
  - 可调点大小（Point Size）
  - 导出：Save PLY
- 支持 XYZ 和 XYZ+RGB 两种格式

### 3.5 视图同步（View Sync）

- 支持将两个变量**配对**，实现可视化联动：
  - 图像查看器之间：同步缩放和平移
  - 3D 查看器之间：同步旋转和缩放
  - 曲线查看器之间：同步缩放和平移范围
- 在 TreeView 中通过右键菜单配对变量

### 3.6 自动刷新（Auto Refresh）

- 每次调试器**单步执行**（step over / step in / step out / continue 后暂停）时，自动重新获取变量数据并更新所有打开的 Webview
- 监听 VS Code `onDidReceiveDebugSessionCustomEvent` 或 `onDidChangeActiveDebugSession` 事件

---

## 四、调试器兼容性

### Python

| 调试器 | `debugSession.type` | 说明 |
|--------|---------------------|------|
| debugpy | `"python"` 或 `"debugpy"` | VS Code Python Extension |
| Jupyter | `"jupyter"` | Jupyter Notebook 调试（可选支持） |

### C++

| 调试器 | `debugSession.type` | 说明 |
|--------|---------------------|------|
| GDB | `"cppdbg"` | C/C++ 扩展（ms-vscode.cpptools），Linux / macOS / WSL |
| vsdbg | `"cppvsdbg"` | Visual Studio Windows Debugger，需要 Visual Studio 2019+ |
| CodeLLDB | `"lldb"` | CodeLLDB 扩展（vadimcn.vscode-lldb），Windows（推荐）/ macOS / Linux |

### 数据获取策略

不同于 C++ 版需要手动读取内存，Python 版可以通过 **DAP evaluate 请求**直接执行 Python 表达式获取数据，更加简洁：

```
// 获取 numpy 数组信息
evaluate: "import json; import numpy as np; arr = <varname>; json.dumps({'shape': list(arr.shape), 'dtype': str(arr.dtype)})"

// 获取数组数据（小数组）
evaluate: "<varname>.tolist()"

// 获取数组数据（大数组，Base64编码）
evaluate: "import base64; import numpy as np; base64.b64encode(<varname>.tobytes()).decode()"
```

### 大数据传输策略

- **小数据**（< 1MB）：直接通过 `evaluate` → `tolist()` 获取 JSON 数组
- **大数据**（>= 1MB）：通过 `evaluate` 执行 `numpy.tobytes()` + Base64 编码传输
- 传输时显示进度提示（与 C++ 版的分块内存读取对应）

---

## 五、项目架构设计

### 5.1 模块划分

```
src/
├── extension.ts              # 扩展入口，变量可视化主逻辑
├── mvVariablesProvider.ts    # TreeView 变量列表提供器
├── adapters/                 # 语言适配器层（核心扩展点）
│   ├── IDebugAdapter.ts      # 统一接口：VariableInfo + VisualizableKind + IDebugAdapter
│   ├── adapterRegistry.ts    # 注册中心：session.type → IDebugAdapter
│   ├── python/               # Python / debugpy / Jupyter 适配器
│   │   ├── pythonDebugger.ts # DAP 通信（evaluate / fetchArrayData / getVariablesInScope）
│   │   ├── pythonTypes.ts    # 纯函数类型检测（Layer 1 + Layer 2）
│   │   ├── imageProvider.ts  # 图像数据获取（ndarray / PIL / Tensor）
│   │   ├── plotProvider.ts   # 1D 数据获取
│   │   ├── pointCloudProvider.ts # 点云数据获取
│   │   └── pythonAdapter.ts  # 实现 IDebugAdapter，委托给上述 providers
│   └── cpp/                  # C++ 适配器（骨架，待实现）
│       ├── cppTypes.ts       # Layer-1 类型检测（cv::Mat / Eigen / std::vector / pcl）
│       └── cppAdapter.ts     # 实现 IDebugAdapter，各 fetch 方法返回 null
├── viewers/
│   └── viewerTypes.ts        # 语言无关展示数据类型（ImageData / PlotData / PointCloudData）
├── utils/
│   ├── debugger.ts           # 兼容 re-export → adapters/python/pythonDebugger
│   ├── pythonTypes.ts        # 兼容 re-export → adapters/python/pythonTypes
│   ├── panelManager.ts       # Webview 面板生命周期、自动刷新（使用 IDebugAdapter）
│   └── syncManager.ts        # 变量配对同步管理
├── matImage/
│   ├── matProvider.ts        # 兼容 re-export → adapters/python/imageProvider
│   └── matWebview.ts         # 图像 Webview HTML 模板
├── plot/
│   ├── plotProvider.ts       # 兼容 re-export → adapters/python/plotProvider
│   └── plotWebview.ts        # 曲线图 Webview HTML 模板（uPlot）
└── pointCloud/
    ├── pointCloudProvider.ts # 兼容 re-export → adapters/python/pointCloudProvider
    └── pointCloudWebview.ts  # 点云 Webview HTML 模板（Three.js）
```

### 5.2 适配器模式设计

**核心原则**：扩展核心（extension.ts、panelManager.ts、mvVariablesProvider.ts）**仅依赖接口 IDebugAdapter**，永远不导入任何语言特定代码。

| 层次 | 职责 | 语言相关？ |
|------|------|----------|
| `IDebugAdapter` 接口 | 定义变量枚举、类型检测、数据获取的统一契约 | 否 |
| `ILibProviders.ts` | `ILibImageProvider` / `ILibPlotProvider` / `ILibPointCloudProvider` 三方库统一契约 | 否 |
| `viewers/viewerTypes.ts` | `ImageData` / `PlotData` / `PointCloudData` 展示端数据格式 | 否 |
| `adapters/<lang>/libs/<libName>/` | 具体库实现：`canHandle()` + `fetch*Data()` | 是 |
| `adapters/<lang>/*Provider.ts` | 分发器：遍历 `LIB_*_PROVIDERS` 列表，委托给首个匹配的库 | 是 |
| `adapters/python/` | Python/debugpy/Jupyter 的完整实现 | 是 |
| `adapters/cpp/` | C++ 骨架，fetch 分发器待实现 | 是 |
| `adapterRegistry.ts` | `getAdapter(session)` 按序匹配 | 否 |

**添加新库支持的步骤**：
1. 在 `src/adapters/<lang>/libs/<libName>/` 下实现 `ILib*Provider`
2. 将新实例追加到分发器的 `LIB_*_PROVIDERS` 数组中
3. 在 `<lang>Types.ts` 中补充 Layer-1 匹配模式

**添加新语言支持的步骤**：
1. 在 `src/adapters/<lang>/` 下实现 `IDebugAdapter`、创建 `libs/` 子目录
2. 在 `adapterRegistry.ts` 的 `ADAPTERS` 数组中注册

### 5.3 类型检测架构（对应 C++ 版的两层检测）

**第一层：基础检测（快速，用于 TreeView 列表分类）**
- 通过变量的 `type` 字符串匹配：`"numpy.ndarray"`, `"PIL.Image"`, `"torch.Tensor"`, `"list"`, `"tuple"`, `"cv::Mat"` 等
- 不需要调试器 evaluate，速度快

**第二层：增强检测（精确，用于实际可视化）**
- 通过 DAP evaluate / 变量子结点获取 shape、dtype 等信息
- 根据 shape 和 dtype 精确判断图像 / 曲线 / 点云

### 5.4 数据读取流程

```
用户点击变量
    ↓
adapterRegistry.getAdapter(session)     # 根据 session.type 选择适配器
    ↓
adapter.basicTypeDetect(类型字符串)     # Layer-1 快速分类
    ↓
adapter.getVariableInfo(session, 变量名)  # 获取 shape / dtype
    ↓
adapter.detectVisualizableType(info)     # Layer-2 精确判断
    ↓
判断数据大小
    ↓
小数据 → adapter.fetch*(JSON 路径)
大数据 → adapter.fetch*(Base64 路径)
    ↓
Webview 渲染
```

---

## 六、使用方式

### 方式 1：MatrixViewer Debug 面板（推荐）

1. 启动 Python 调试会话
2. 打开 **"运行和调试"** 侧边栏
3. 找到 **MatrixViewer Debug** 区域
4. 点击变量名即可查看

### 方式 2：右键菜单

调试过程中，在变量上右键 → **"View by MatrixViewer Debug"**

---

## 七、系统要求

- VS Code 1.93.0+
- Python 调试器：[Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)（内置 debugpy）
- 被调试的 Python 环境中需要安装相应库（numpy、Pillow、PyTorch 为可选依赖，插件应优雅处理缺失情况）

---

## 八、与 C++ 版的差异说明

| 方面 | C++ 版 | Python 版 |
|------|--------|-----------|
| 数据获取方式 | 通过 DAP `readMemory` 直接读取内存 | 通过 DAP `evaluate` 执行 Python 表达式 |
| 类型检测复杂度 | 高（需区分 CodeLLDB/GDB/vsdbg，STL 内部成员名差异） | 低（统一 debugpy，Python 对象有统一接口） |
| 支持的图像库 | OpenCV cv::Mat 为主 | numpy ndarray 为主，兼容 PIL/PyTorch |
| 调试器适配 | `cppAdapter.ts` 实现 `IDebugAdapter`（骨架已完成，待填充） | `pythonAdapter.ts` 实现 `IDebugAdapter`（完整实现） |
| 内存读取 | 分块并行内存读取（`readMemory` DAP） | Base64 encoded bytes via evaluate |
| 指针类型 | 需要解引用指针 | Python 无裸指针，不需要 |

---

## 九、实现优先级（分阶段）

### Phase 1：核心基础（MVP）
- [x] 基础 VS Code 扩展框架（TypeScript）
- [x] 接入 debugpy DAP，获取当前帧变量列表
- [x] 基础类型检测（识别 numpy ndarray）
- [x] 图像查看器 Webview（显示 numpy 图像）
- [x] 自动刷新（单步调试时更新）

### Phase 2：完善类型支持
- [x] 1D 曲线图查看器（list/ndarray 1D）
- [x] 变量面板 TreeView（自动检测分类）
- [x] 大数据 Base64 传输支持
- [x] 导出功能（PNG/CSV/PLY）

### Phase 3：高级功能
- [x] PIL.Image 支持
- [x] PyTorch Tensor 支持
- [x] 3D 点云查看器（Three.js）
- [x] 视图同步（配对联动）
- [x] 自定义 X 轴（Plot Viewer）
- [x] 右键菜单集成

### Phase 4：体验优化
- [ ] 进度提示（大数据加载时）
- [x] 图像悬停像素信息
- [x] 数据统计信息（min/max/mean/std）
- [x] 伪彩色映射（Colormap）
- [ ] Jupyter Notebook 调试支持

### Phase 5：C++ 适配器
- [x] `cppAdapter.ts` 实现 `getVariablesInScope` / `fetchImageData` / `fetchPlotData` / `fetchPointCloudData`（按 session.type 路由到 `gdb/` / `codelldb/` / `cppvsdbg/`）
- [x] `shared/debuggerBase.ts` — 共享 DAP 工具（`getCurrentFrameId` / `readMemoryChunked` / `parseSizeFromValue`）
- [x] `gdb/debugger.ts` — GDB（cppdbg）专用：`(long long)` 类型转换，`repl` context
- [x] `cppvsdbg/debugger.ts` — vsdbg（cppvsdbg）专用：同 GDB 表达式，独立演化
- [x] `codelldb/debugger.ts` — CodeLLDB（lldb）专用：裸指针，`watch` context，STL 内部字段回退
- [x] `cv::Mat` 图像数据获取（各 `{debugger}/libs/opencv/imageProvider.ts`）
- [x] `std::vector<T>` / `std::array<T,N>` / `T[N]` 曲线数据获取（各 `{debugger}/libs/std/plotProvider.ts`）
- [x] 2D/3D `std::array` 和 C-style array 图像数据获取（各 `{debugger}/libs/std/imageProvider.ts`）
- [x] `std::vector<cv::Point3f/d>` / `std::array<cv::Point3f/d,N>` 点云数据获取（各 `{debugger}/libs/std/pointCloudProvider.ts`）
- [x] `Eigen::Matrix` / `Eigen::Array` / `Eigen::VectorX` 曲线数据获取（各 `{debugger}/libs/eigen/plotProvider.ts`）
  - `cols==1` 或 `rows==1` → 1D 折线图
  - `cols==2` → 2D 散点图（Eigen 列优先：X=col0, Y=col1）
- [x] `Eigen::Matrix` / `Eigen::Array` (rows>1, cols>2) 图像数据获取（各 `{debugger}/libs/eigen/imageProvider.ts`）
- [x] `pcl::PointCloud<PointXYZ/XYZRGB/XYZRGBA/XYZI>` 点云数据获取（各 `{debugger}/libs/pcl/pointCloudProvider.ts`）

### Phase 6：Qt5 / Qt6 C++ 类型支持

> 所有实现位于各 `src/adapters/cpp/{gdb,codelldb,cppvsdbg}/libs/qt/`，兼容 Qt5 与 Qt6。

#### 类型检测（`cppTypes.ts`）
- [x] Layer-1 识别 `QImage`（类型字符串匹配）
- [x] Layer-1 识别 `QVector<T>` / `QList<T>`（数值类型，Qt6 中两者合并）
- [x] Layer-1 识别 `QPolygonF`
- [x] Layer-1 识别 `QVector<QVector2D>` / `QList<QVector2D>`
- [x] Layer-1 识别 `QVector<QVector3D>`

#### 实现文件
- [x] `libs/qt/qtUtils.ts` — Qt 类型辅助：`QtImageFormat` 枚举、`getQImageInfo()`（兼容 `byteCount()` / `sizeInBytes()`）
- [x] `libs/qt/imageProvider.ts` — `QImage` → `ImageData`
  - 通过 DAP evaluate 读取 `width()` / `height()` / `format()`
  - Qt5：用 `byteCount()` 获取字节数；Qt6：用 `sizeInBytes()`（fallback 到 `byteCount()`）
  - 通过 `readMemory` 读取 `bits()` 指针处的像素缓冲区
  - 支持格式：`Format_Grayscale8`（1ch uint8）、`Format_RGB32` / `Format_ARGB32`（4ch）、`Format_RGB888`（3ch uint8）
- [x] `libs/qt/plotProvider.ts` — `QVector<T>` / `QList<T>` / `QPolygonF` / `QVector<QVector2D>` → `PlotData`
  - `QVector<T>` / `QList<T>`（数值型）：通过 `size()` + `data()` 指针读取连续内存 → 1D 折线图
  - `QPolygonF`：同上，每元素为 `QPointF`（8 字节 = 2×double） → 2D 散点图
  - `QVector<QVector2D>`：每元素为 `QVector2D`（8 字节 = 2×float） → 2D 散点图
- [x] `libs/qt/pointCloudProvider.ts` — `QVector<QVector3D>` → `PointCloudData`
  - 通过 `size()` + `data()` 指针读取连续内存，每元素 12 字节（3×float）

#### 协调器注册
- [x] `src/adapters/cpp/imageProvider.ts` — 将 `QtImageProvider` 追加到 `LIB_IMAGE_PROVIDERS`
- [x] `src/adapters/cpp/plotProvider.ts` — 将 `QtPlotProvider` 追加到 `LIB_PLOT_PROVIDERS`
- [x] `src/adapters/cpp/pointCloudProvider.ts` — 将 `QtPointCloudProvider` 追加到 `LIB_POINTCLOUD_PROVIDERS`

#### Qt5 / Qt6 兼容性说明
| 方面 | Qt5 | Qt6 | 处理方式 |
|------|-----|-----|----------|
| `byteCount()` | 存在 | 废弃，改用 `sizeInBytes()` | evaluate 先尝试 `sizeInBytes()`，失败则 fallback 到 `byteCount()` |
| `QVector<T>` 类型字符串 | `QVector<float>` | `QList<float>` 或 `QVector<float>` | Layer-1 正则同时匹配两者 |
| `QPolygonF` 基类 | `QVector<QPointF>` | `QList<QPointF>` | 直接遍历 `size()` + `data()` 即可，无需区分 |
| `QImage::bits()` 返回类型 | `uchar*` | `uchar*` | 无差别 |

---

## 十、当前进度备忘（2026-03-12）

### 已完成（代码骨架层面）

#### 配置文件（全部完成）
- `package.json` — 所有命令 / 视图 / 菜单 / 配置项已声明
- `tsconfig.json` / `tsconfig.test.json` — `module: commonjs`, `moduleResolution: node`（已从 Node16 修复）
- `esbuild.js` — watch / production build 脚本
- `eslint.config.mjs` — TypeScript ESLint 规则
- `.gitignore`, `.vscodeignore`, `.vscode/launch.json`, `.vscode/tasks.json`
- `.github/copilot-instructions.md`, `workflows/ci.yml`, issue 模板
- `README.md` — 参照 C++ 版重写，含类型表、功能表、操作控件表

#### TypeScript 源码（逻辑完整，非占位）
| 文件 | 状态 | 说明 |
|------|------|------|
| `src/extension.ts` | ✅ | 命令注册、DAP 事件监听、可视化分发（使用 adapterRegistry）|
| `src/mvVariablesProvider.ts` | ✅ | TreeView 自动检测、分组、手动添加（使用 IDebugAdapter）|
| `src/adapters/IDebugAdapter.ts` | ✅ | 统一适配器接口定义 |
| `src/adapters/ILibProviders.ts` | ✅ | 三方库统一接口（ILibImageProvider / ILibPlotProvider / ILibPointCloudProvider）|
| `src/adapters/adapterRegistry.ts` | ✅ | session.type → 适配器 注册中心 |
| `src/adapters/python/debugpy/debugger.ts` | ✅ | DAP 通信：evaluate / fetchArrayData（JSON + Base64）|
| `src/adapters/python/pythonTypes.ts` | ✅ | 两层类型检测纯函数 |
| `src/adapters/python/debugpy/imageProvider.ts` | ✅ | 分发器：委托给首个 canHandle() 匹配的 ILibImageProvider |
| `src/adapters/python/debugpy/plotProvider.ts` | ✅ | 分发器：委托给首个 canHandle() 匹配的 ILibPlotProvider |
| `src/adapters/python/debugpy/pointCloudProvider.ts` | ✅ | 分发器：委托给首个 canHandle() 匹配的 ILibPointCloudProvider |
| `src/adapters/python/pythonAdapter.ts` | ✅ | 实现 IDebugAdapter，委托给 debugpy/ 分发器 |
| `src/adapters/python/debugpy/libs/utils.ts` | ✅ | 公用辅助函数 |
| `src/adapters/python/debugpy/libs/numpy/imageProvider.ts` | ✅ | ndarray / cv2.Mat 图像获取 |
| `src/adapters/python/debugpy/libs/numpy/plotProvider.ts` | ✅ | ndarray 1D 曲线获取 |
| `src/adapters/python/debugpy/libs/numpy/pointCloudProvider.ts` | ✅ | ndarray (N,3)/(N,6) 点云获取 |
| `src/adapters/python/debugpy/libs/pil/imageProvider.ts` | ✅ | PIL.Image 图像获取 |
| `src/adapters/python/debugpy/libs/torch/imageProvider.ts` | ✅ | torch.Tensor 图像获取 |
| `src/adapters/python/debugpy/libs/torch/plotProvider.ts` | ✅ | torch.Tensor 1D 曲线获取 |
| `src/adapters/python/debugpy/libs/builtins/plotProvider.ts` | ✅ | list / tuple / range 曲线获取 |
| `src/adapters/python/debugpy/libs/builtins/pointCloudProvider.ts` | ✅ | list of (x,y,z) 点云获取 |
| `src/adapters/cpp/cppTypes.ts` | ✅ | Layer-1 C++ 类型检测（cv::Mat / Eigen / std::vector / std::array / C-style array / Point3 向量 / pcl / 智能指针与原生指针自动解引用）|
| `src/adapters/cpp/shared/debuggerBase.ts` | ✅ | 共享 DAP 工具（getCurrentFrameId / readMemoryChunked / parseSizeFromValue）|
| `src/adapters/cpp/shared/utils.ts` | ✅ | 跨库公用辅助函数（buffer / dtype / stats / SmartPtrUnwrapResult / unwrapSmartPointer）|
| `src/adapters/cpp/cppAdapter.ts` | ✅ | 实现 IDebugAdapter，按 session.type 路由到各调试器 |
| `src/adapters/cpp/gdb/debugger.ts` | ✅ | GDB 专用 DAP 通信（repl context，(long long) 转换，getContainerSize）|
| `src/adapters/cpp/gdb/imageProvider.ts` | ✅ | GDB 图像分发器 |
| `src/adapters/cpp/gdb/plotProvider.ts` | ✅ | GDB 曲线分发器 |
| `src/adapters/cpp/gdb/pointCloudProvider.ts` | ✅ | GDB 点云分发器 |
| `src/adapters/cpp/gdb/libs/{opencv,eigen,pcl,std,qt}/` | ✅ | GDB 各库提供器（仅含 GDB 路径）|
| `src/adapters/cpp/cppvsdbg/debugger.ts` | ✅ | vsdbg 专用 DAP 通信 |
| `src/adapters/cpp/cppvsdbg/imageProvider.ts` | ✅ | vsdbg 图像分发器 |
| `src/adapters/cpp/cppvsdbg/plotProvider.ts` | ✅ | vsdbg 曲线分发器 |
| `src/adapters/cpp/cppvsdbg/pointCloudProvider.ts` | ✅ | vsdbg 点云分发器 |
| `src/adapters/cpp/cppvsdbg/libs/{opencv,eigen,pcl,std,qt}/` | ✅ | vsdbg 各库提供器（仅含 MSVC 路径）|
| `src/adapters/cpp/codelldb/debugger.ts` | ✅ | CodeLLDB 专用 DAP 通信（watch context，裸指针，STL 内部字段回退）|
| `src/adapters/cpp/codelldb/imageProvider.ts` | ✅ | CodeLLDB 图像分发器 |
| `src/adapters/cpp/codelldb/plotProvider.ts` | ✅ | CodeLLDB 曲线分发器 |
| `src/adapters/cpp/codelldb/pointCloudProvider.ts` | ✅ | CodeLLDB 点云分发器 |
| `src/adapters/cpp/codelldb/libs/{opencv,eigen,pcl,std,qt}/` | ✅ | CodeLLDB 各库提供器（仅含 LLDB 路径）|
| `src/viewers/viewerTypes.ts` | ✅ | 语言无关统一展示数据类型 |
| `src/utils/panelManager.ts` | ✅ | Webview 面板生命周期、自动刷新、sync broadcast（使用 IDebugAdapter）|
| `src/utils/syncManager.ts` | ✅ | idle → waiting → paired 状态机 |
| `src/matImage/matWebview.ts` | ✅ | 图像 HTML 模板（CSP nonce）|
| `src/plot/plotWebview.ts` | ✅ | 曲线图 HTML 模板（uPlot）|
| `src/pointCloud/pointCloudWebview.ts` | ✅ | 点云 HTML 模板（Three.js）|

#### 前端资源 media/（逻辑完整）
| 文件 | 状态 | 说明 |
|------|------|------|
| `image-viewer.js` | ✅ | Canvas 渲染、zoom/pan、colormap、hover 像素值、Save PNG |
| `plot-viewer.js` | ✅ | uPlot 封装、Line/Scatter/Histogram、Save PNG/CSV |
| `pointcloud-viewer.js` | ✅ | Three.js 场景、OrbitControls、按轴着色、Save PLY |
| `colormaps.js` | ✅ | gray / jet / hot / viridis / plasma LUT |
| `image-viewer.css` / `plot-viewer.css` / `pointcloud-viewer.css` | ✅ | 样式 |
| `uplot.iife.min.js` | ✅ 已下载（uPlot latest）|
| `three.min.js` | ✅ 已下载（Three.js r127）|
| `OrbitControls.js` | ✅ 已下载（Three.js r127 legacy）|

#### 测试
- `src/test/pythonTypes.test.ts` — pythonTypes.ts 纯函数单元测试（已有）

---

### 未完成 / 待处理事项

#### P0（阻塞运行——必须先处理）

1. ~~**下载三个 vendor 前端库**~~ ✅ 已完成（2026-03-12）
   - `media/uplot.iife.min.js` — uPlot latest
   - `media/three.min.js` — Three.js r127
   - `media/OrbitControls.js` — Three.js r127 legacy（全局 `THREE.OrbitControls`）

2. ~~**构建验证**~~ ✅ 已完成（2026-03-12）
   - Node.js 22.22.1 已安装
   - `npm install` 完成（node_modules 就绪）
   - `npm run compile`：tsc 零错误，eslint 零错误，esbuild 打包成功
   - 修复了 eslint 配置（`typescript-eslint` 统一包 → 分包，补充 Node/mocha globals）
   - `dist/extension.js` 已生成

#### P1（发布前必须）

3. ~~**扩展图标**~~ ✅ 已完成（2026-03-12）
   - `package.json` `"icon"` 字段已更新为 `"assets/icon_256x256.ico"`

4. ~~**Python 测试样例项目**~~ ✅ 已完成（2026-03-12）
   - `test/test_python/demo.py` — 覆盖所有支持类型（见下表），使用 `assets/test_img.png`（2048×2048 RGBA）
   - `test/test_python/requirements.txt`
   - `test/test_python/.vscode/launch.json`（debugpy launch config）
   - `test/test_python/README.md`

5. **C++ 测试样例项目** 🔲 待完善
   - `test/test_cpp/` — C++ 调试演示（待补充 demo 代码和 launch.json）

| demo.py 变量 | 类型 | 对应 Viewer |
|---|---|---|
| `grayscale_u8` | ndarray (2048,2048) uint8 | 🖼️ 图像 |
| `grayscale_f32` | ndarray (2048,2048) float32 | 🖼️ 图像（需 Normalize）|
| `bgr_u8` | ndarray (2048,2048,3) uint8 | 🖼️ 图像（BGR）|
| `rgba_u8` | ndarray (2048,2048,4) uint8 | 🖼️ 图像（RGBA）|
| `small_float_img` | ndarray (64,64) float32 | 🖼️ 图像（小图，float）|
| `single_ch` | ndarray (2048,2048,1) uint8 | 🖼️ 图像（单通道）|
| `pil_image` | PIL.Image (RGBA) | 🖼️ 图像 |
| `pil_gray` | PIL.Image (L) | 🖼️ 图像 |
| `signal_1d` | ndarray (512,) float32 | 📈 曲线 |
| `noise_1d` | ndarray (512,) float32 | 📈 曲线 |
| `ramp_1d` | ndarray (512,) float64 | 📈 曲线 |
| `my_list` | list[float] | 📈 曲线 |
| `my_tuple` | tuple[int] | 📈 曲线 |
| `cloud_xyz` | ndarray (4096,3) float32 | 📊 点云（XYZ）|
| `cloud_xyzrgb` | ndarray (4096,6) float32 | 📊 点云（XYZ+RGB）|
| `tiny_img/1d/cloud` | 各类型最小值 | 边界用例 |

#### P2（质量完善）

5. **集成测试** — 当前只有 `pythonTypes.ts` 的纯函数单元测试，缺少：
   - mock `vscode.DebugSession` 的 DAP 通信测试
   - 各 Provider 的数据获取逻辑测试

6. **实际端到端验证**：
   - PIL.Image 数据路径验证（`matProvider.ts` PIL 分支）
   - PyTorch Tensor 大数组 Base64 传输验证
   - 超大数组（>1MB）Base64 路径验证

#### P3（体验完善）

7. **进度提示** — 大数据加载时显示 loading 状态（Phase 4 待实现）

8. **Jupyter Notebook 调试支持** — `session.type === "jupyter"` 分支（Phase 4 待实现）

9. **CHANGELOG.md** — 发布所需

---

### 已修复的 Bug 记录

| Bug | 原因 | 修复方式 |
|-----|------|----------|
| `session.customRequest(...).catch` 不存在 | VS Code DAP API 返回 `Thenable`，非 `Promise` | 包装为 `Promise.resolve(session.customRequest(...)).catch()` |
| `Array.from(view as Iterable<number>)` 类型错误 | `DataView` 不可迭代 | 改为 `Array.from(view as unknown as number[])` |
| 模块找不到（"找不到模块或其相应的类型声明"）| `tsconfig.json` 使用 `module: Node16` | 改为 `module: commonjs`, `moduleResolution: node` |
