---
applyTo: "**"
---

# 文档同步规则 — 每次请求完成后必须执行

## 规则说明

每次完成用户请求（无论是新增功能、重构、修复 Bug、还是架构变更），必须在回复结束前检查并同步以下四份文档，确保其内容与代码库当前状态保持一致：

| 文件 | 职责 |
|------|------|
| `.github/copilot-instructions.md` | 面向 Copilot 的架构参考与常见任务指南（英文） |
| `README.md` | 面向用户的功能说明（英文） |
| `README_CN.md` | 面向用户的功能说明（中文） |
| `docs/requirements.md` | 需求与功能追踪表 |

---

## 需要触发更新的变更类型

下列任意一种变更发生时，**必须**检查并更新受影响的文档：

- 新增或删除了 `src/adapters/` 下的适配器、库提供者（`libs/<libName>/`）或协调器
- 新增或删除了支持的数据类型（numpy、PIL、torch、cv2、内置类型等）
- 新增或删除了支持的可视化类型（Image / Plot / PointCloud）
- 新增或删除了 VS Code 命令（`contributes.commands`）
- 修改了核心接口（`IDebugAdapter`、`ILibProviders`、`viewerTypes`）
- 修改了目录结构（移动文件、重命名模块、新建子目录）
- 修改了构建/测试流程（`package.json` scripts、`esbuild.js`、`tsconfig.json`）
- 修改了 WebView 控件或前端功能（`media/`、`*Webview.ts`）
- 修改了 `libs/` 内部文件放置规则（`libs/utils.ts` 与 `libs/<libName>/` 的职责边界）

---

## 检查步骤（每次请求结束前执行）

### 1. 识别受影响范围
根据本次变更的类型，判断哪些文档段落需要更新。

### 2. 检查 `.github/copilot-instructions.md`
- `Architecture` 代码树（`src/` 结构）
- `Key design patterns` 中的注意事项
- `Common Tasks for Copilot` 各子章节（添加新库、新语言等的步骤说明）
- `Tech Stack` 表格
- `libs/ internal file placement rules` 中的示例表格与决策树（当 `libs/` 下有文件移动或新增时）

### 3. 检查 `README.md`
- `Features` / `Supported Types` 表格
- `Architecture` 概览段落
- `Usage` 相关截图说明（如架构图有变化）

### 4. 检查 `README_CN.md`
与 `README.md` 保持相同结构；中文内容须对应同步更新（英中保持一致）。

### 5. 检查 `docs/requirements.md`
- 功能条目与当前实现的对应状态（`已实现` / `计划中` / `TODO`）
- 源码文件映射表（如有）

---

## 更新原则

1. **最小化改动** — 只更新真正受影响的段落，不重写无关内容。
2. **准确性优先** — 文档中的文件路径、类名、接口名必须与代码完全一致。
3. **双语同步** — `README.md` 与 `README_CN.md` 须保持结构和信息对称。
4. **不添加主观评价** — 文档描述客观事实，不加"更好"、"优化了"等措辞。
5. **如果文档已是最新状态** — 无需修改，直接跳过，不必声明"文档已是最新"。
