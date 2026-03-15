---
applyTo: "src/**/*.ts"
---

# 日志规范 — 单例 Logger

## 定义位置

日志模块定义在 `src/log/logger.ts`，导出一个单例 `logger` 及四个按级别命名的便捷函数。

## 初始化（仅在 extension.ts 中执行一次）

```typescript
import { logger, debug, info, warn, error } from "./log/logger";

export function activate(context: vscode.ExtensionContext) {
    const channel = vscode.window.createOutputChannel("MatrixViewer");
    logger.init(channel);
    context.subscriptions.push(channel);
}
```

## 其他文件的使用方式

只 import `logger` 单例，调用对应级别的方法，**不得**注入 `LogFn` 参数，**不得**使用 `console.log`。

```typescript
import { logger } from "../../log/logger"; // 按需引入

logger.debug(`fetched ${count} points`);
logger.warn(`unsupported type: ${typeName}`);
```

## 电平过滤

```typescript
import { logger } from "../../log/logger";
logger.setLevel("INFO"); // 生产环境关闭 DEBUG 输出
```

## 日志级别

| 级别 | 函数 | 使用场景 |
|------|------|----------|
| `DEBUG` | `debug(msg)` | 内部状态、变量形状、中间值（生产环境默认过滤）|
| `INFO`  | `info(msg)`  | 关键操作成功（面板已打开、变量已获取）|
| `WARN`  | `warn(msg)`  | 可恢复的问题（不支持的变量类型、缺少可选字段）|
| `ERROR` | `error(msg)` | 意外失败（DAP 请求失败、数据解析错误）|

## 规则

- **禁止**在 `src/` 任何文件中使用 `console.log` / `console.warn` / `console.error`。
- **禁止**通过构造函数或函数参数注入 `LogFn`；单例已全局可用，无需注入。
- **禁止**直接调用 `logger.logf()`（该方法为 `private`）。
- Import 时只引入本文件实际用到的级别函数，保持 import 最小化。
