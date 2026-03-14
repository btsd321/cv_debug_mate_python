---
applyTo: "src/**/*.ts"
---

# 日志规范 — 使用统一输出通道

## 定义位置

日志通道与辅助函数定义在 `src/extension.ts`：

```typescript
const logOut = vscode.window.createOutputChannel("MatrixViewer");

function log(level: "DEBUG" | "INFO" | "WARN" | "ERROR", message: string): void {
  logOut.appendLine(`[${level}] ${message}`);
}
```

## 规则

- **禁止**在 `src/` 任何文件中使用 `console.log` / `console.warn` / `console.error`，一律改用 `log()`。
- `log()` 仅在 `extension.ts` 中定义。其他文件需要日志时，必须通过构造函数参数或函数参数注入，**不得**直接 import `logOut`。
- 推荐的注入签名：`type LogFn = (level: "DEBUG" | "INFO" | "WARN" | "ERROR", msg: string) => void`。

## 日志级别

| 级别 | 使用场景 |
|------|---------|
| `DEBUG` | 内部状态、变量形状、中间值（生产环境默认关闭）|
| `INFO` | 关键操作成功（面板已打开、变量已获取）|
| `WARN` | 可恢复的问题（不支持的变量类型、缺少可选字段）|
| `ERROR` | 意外失败（DAP 请求失败、数据解析错误）|
