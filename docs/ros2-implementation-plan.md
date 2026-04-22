# ROS 2 消息可视化实现方案（仅 Linux + GDB）

> 范围：在 `src/adapters/cpp/gdb/libs/ros2/` 下新增一个库，使 `cppdbg` 调试 ROS 2 程序时可直接可视化 `sensor_msgs::msg::Image` 与 `sensor_msgs::msg::PointCloud2`。  
> CodeLLDB / cppvsdbg 暂不支持（保持 `libs/` 目录为空即可，不会触发 provider）。

---

## 1. 目标消息类型

| 消息类型 | 可视化 | 优先级 |
|---|---|---|
| `sensor_msgs::msg::Image_<Alloc>` | Image Viewer | P0 |
| `sensor_msgs::msg::PointCloud2_<Alloc>` | Point Cloud Viewer | P0 |
| `sensor_msgs::msg::CompressedImage_<Alloc>` | 暂不支持（需 JPEG/PNG 解码器） | — |
| `sensor_msgs::msg::LaserScan_<Alloc>` | 后续可加（Plot 1D） | P1（不在本次范围） |

> ROS 2 生成的 C++ 类型实际为 `sensor_msgs::msg::Image_<std::allocator<void>>` 等模板形式，类型识别需用 `startsWith` 匹配前缀。

---

## 2. 内存布局参考

### 2.1 `sensor_msgs::msg::Image_<Alloc>`

| 字段 | 类型 | 说明 |
|---|---|---|
| `header` | `std_msgs::msg::Header_<Alloc>` | 不需要 |
| `height` | `uint32_t` | 行数 |
| `width` | `uint32_t` | 列数 |
| `encoding` | `std::basic_string<char,...,Alloc>` | `rgb8` / `bgr8` / `mono8` / `mono16` / `32FC1` / `bgra8` / `rgba8` 等 |
| `is_bigendian` | `uint8_t` | 通常为 0 |
| `step` | `uint32_t` | 每行字节数 = `width * channels * bytesPerChannel`（可能含 padding） |
| `data` | `std::vector<uint8_t, Alloc>` | 行优先字节流，长度 = `step * height` |

### 2.2 `sensor_msgs::msg::PointCloud2_<Alloc>`

| 字段 | 类型 | 说明 |
|---|---|---|
| `header` | Header | 不需要 |
| `height` | `uint32_t` | 通常 1（无序点云） |
| `width` | `uint32_t` | 点数 |
| `fields` | `std::vector<PointField_<Alloc>, Alloc>` | 字段描述数组 |
| `is_bigendian` | `uint8_t` | 通常 0 |
| `point_step` | `uint32_t` | 单点字节数 |
| `row_step` | `uint32_t` | 单行字节数 = `point_step * width` |
| `data` | `std::vector<uint8_t, Alloc>` | 紧凑打包字节流 |
| `is_dense` | `uint8_t` | 不需要 |

`PointField_<Alloc>` 字段：

| 字段 | 类型 |
|---|---|
| `name` | `std::string` |
| `offset` | `uint32_t` |
| `datatype` | `uint8_t` （1=INT8 2=UINT8 3=INT16 4=UINT16 5=INT32 6=UINT32 **7=FLOAT32** 8=FLOAT64） |
| `count` | `uint32_t` |

---

## 3. 文件结构

新增文件：

```
src/adapters/cpp/gdb/libs/ros2/
├── ros2Utils.ts            # 类型识别 + std::string/std::vector 元信息读取 + PointField 解析 + encoding→(channels,dtype) 映射
├── imageProvider.ts        # ILibImageProvider for sensor_msgs::msg::Image
└── pointCloudProvider.ts   # ILibPointCloudProvider for sensor_msgs::msg::PointCloud2
```

修改文件：

| 文件 | 改动 |
|---|---|
| `src/adapters/cpp/cppTypes.ts` | `IMAGE_TYPE_PATTERNS` 增加 `sensor_msgs::msg::Image_`；`POINTCLOUD_TYPE_PATTERNS` 增加 `sensor_msgs::msg::PointCloud2_` |
| `src/adapters/cpp/gdb/imageProvider.ts` | `PROVIDERS` 列表追加 `new Ros2ImageProvider()` |
| `src/adapters/cpp/gdb/pointCloudProvider.ts` | `PROVIDERS` 列表追加 `new Ros2PointCloudProvider()` |

---

## 4. 设计要点

### 4.1 取值策略（GDB 专用）

复用 `gdb/debugger.ts` 现有工具：

- `evaluateExpression(session, expr, frameId)` —— 取标量字段（`(uint32_t)var.height`）
- `tryGetDataPointer(session, exprs, frameId)` —— 取 `data` 缓冲首地址，使用 `(long long)var.data.data()` 或 `(long long)&var.data[0]`
- `readMemoryChunked(session, ptr, totalBytes)` —— 拉取整块字节流
- `getContainerSize(session, "var.fields", frameId)` —— PointCloud2 字段数量

### 4.2 std::string 读取（encoding / PointField.name）

GDB（libstdc++）下 `std::string` 内部布局为 `_M_dataplus._M_p`，但用 `evaluateExpression` 读 `var.encoding` 已能直接得到带引号的字符串字面量（如 `"rgb8"`）。处理时去掉首尾引号即可。

如果 evaluate 失败，备用：`*(const char**)&var.encoding._M_dataplus._M_p`，再 readMemory 一段并按 `\0` 截断。第一版仅实现 evaluate 路径。

### 4.3 encoding → (channels, dtype, format) 映射

| encoding | channels | dtype | format |
|---|---|---|---|
| `mono8` | 1 | uint8 | GRAY |
| `mono16` | 1 | uint16 | GRAY |
| `8UC1` / `8SC1` | 1 | uint8 / int8 | GRAY |
| `16UC1` / `16SC1` | 1 | uint16 / int16 | GRAY |
| `32FC1` | 1 | float32 | GRAY |
| `64FC1` | 1 | float64 | GRAY |
| `rgb8` | 3 | uint8 | RGB |
| `bgr8` | 3 | uint8 | BGR |
| `rgba8` | 4 | uint8 | RGBA |
| `bgra8` | 4 | uint8 | BGRA |
| `8UC3` | 3 | uint8 | BGR（OpenCV 习惯） |
| `8UC4` | 4 | uint8 | BGRA |
| `32FC3` | 3 | float32 | RGB |
| `32FC4` | 4 | float32 | RGBA |
| 其它 | 返回 null（不支持） |

### 4.4 step 与 padding 处理

`step` 不一定等于 `width * channels * bytesPerPixel`；可能含行尾 padding。读取整块 `step * height` 字节后，若发现 `step != width * channels * bps`，需要按行裁掉 padding 再传给 webview（简化：第一版 readMemory `step*height`，再循环 `height` 次每行只复制前 `width * channels * bps` 字节到新 `Uint8Array`）。

### 4.5 PointCloud2 字段解析

1. 先 `getContainerSize(session, "var.fields")` 得到字段数量 N。
2. 循环 `i = 0..N-1`：
   - `evaluateExpression("var.fields[i].name")` → 去引号
   - `evaluateExpression("(int)var.fields[i].offset")`
   - `evaluateExpression("(int)var.fields[i].datatype")`
3. 找到 `name == "x" / "y" / "z"` 且 `datatype == 7 (FLOAT32)`；可选 `name == "rgb" / "rgba"`（datatype 7，按 PCL 约定按 4 字节 BGRA 解读）或 `name == "intensity"`。
4. 不满足（缺 xyz / 非 float32）→ 返回 null（warn）。

> 第一版仅支持 xyz 全部为 FLOAT32 的常见情况。INT16/FLOAT64 等留待后续。

### 4.6 数据解包

- **Image**：`readMemoryChunked` → 视情况裁掉行尾 padding → `bufferToBase64` → 返回 `ImageData`
- **PointCloud2**：`readMemoryChunked` 取 `point_step * pointCount` 字节 → `DataView` 按 offset 跨 `point_step` 提取 xyz（可选 rgb）→ 复用 `computeBounds`

---

## 5. 类型识别（cppTypes.ts）

`IMAGE_TYPE_PATTERNS` 追加：
```js
/\bsensor_msgs::msg::Image_\b/,
```

`POINTCLOUD_TYPE_PATTERNS` 追加：
```js
/\bsensor_msgs::msg::PointCloud2_\b/,
```

智能指针包装（`shared_ptr<sensor_msgs::msg::Image>`）通过现有 `unwrapSmartPointer` 自动处理。

---

## 6. 风险与限制

| 项 | 说明 |
|---|---|
| 仅 GDB | 不在 codelldb / cppvsdbg 实现；现有架构天然隔离，不影响其它 debugger |
| 必须有 debug info | 需 `-g`、且 ROS 2 包未 strip |
| `std::string` 读取依赖 evaluate 引号格式 | 如调试器返回非引号格式，需后续补回退路径 |
| step padding | 第一版裁剪逻辑仅在 `step != width*channels*bps` 时执行 |
| 大点云 | 已通过 `readMemoryChunked` 分段，无需特殊处理 |
| 无单元测试 | 类型识别可加 `cppTypes` 单测；端到端需真实 ROS 2 环境，本次不引入测试样例 |

---

## 7. 实施步骤（与 todo 对应）

1. **type patterns**：修改 `cppTypes.ts`。
2. **ros2Utils.ts**：实现 encoding 映射表、PointField 解析辅助、std::string 解析辅助。
3. **imageProvider.ts**：实现 `Ros2ImageProvider`。
4. **pointCloudProvider.ts**：实现 `Ros2PointCloudProvider`。
5. **协调器注册**：在 `gdb/imageProvider.ts` 与 `gdb/pointCloudProvider.ts` 的 `PROVIDERS` 列表追加。
6. **编译验证**：`npm run compile` 通过。
7. **同步文档**：`copilot-instructions.md`（架构树 + 库列表）、`README.md` / `README_CN.md`（C++ 支持表添加 ROS 2 行）、`docs/requirements.md`（添加 ROS 2 需求条目并标记"已实现 (GDB only)"）。

---

## 8. 不在本次范围

- CodeLLDB / cppvsdbg 实现
- `CompressedImage`（需 JPEG/PNG 解码）
- `LaserScan`（Plot）
- ROS 1 (`sensor_msgs::Image`，不带 `::msg::`，不带 `_<Alloc>`)
- 端到端测试样例
