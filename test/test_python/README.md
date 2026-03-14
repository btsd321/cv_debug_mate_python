# test_python — MatrixViewer Debug Demo Project

Quick demo that exercises every supported variable type.

## Setup

```bash
cd test_python
pip install -r requirements.txt
```

## Run

1. Open this folder in VS Code:
   ```bash
   code .
   ```
2. Open `demo.py`.
3. Press **F5** (uses the `"Matrix Viewer: Run demo.py"` launch config).
4. The script stops at `breakpoint()`.
5. Open the **Run and Debug** sidebar → find the **MatrixViewer Debug** panel.
6. Click any variable to open its viewer.

## Variables

| Variable | Type | Viewer |
|---|---|---|
| `grayscale_u8` | `ndarray (2048,2048) uint8` | 🖼️ Image (grayscale) |
| `grayscale_f32` | `ndarray (2048,2048) float32` | 🖼️ Image (normalize) |
| `bgr_u8` | `ndarray (2048,2048,3) uint8` | 🖼️ Image (BGR) |
| `rgba_u8` | `ndarray (2048,2048,4) uint8` | 🖼️ Image (RGBA) |
| `small_float_img` | `ndarray (64,64) float32` | 🖼️ Image (float, Auto-Normalize) |
| `single_ch` | `ndarray (2048,2048,1) uint8` | 🖼️ Image (single ch) |
| `pil_image` | `PIL.Image (RGBA)` | 🖼️ Image |
| `pil_gray` | `PIL.Image (L)` | 🖼️ Image |
| `signal_1d` | `ndarray (512,) float32` | 📈 Plot (sine) |
| `noise_1d` | `ndarray (512,) float32` | 📈 Plot (noise) |
| `ramp_1d` | `ndarray (512,) float64` | 📈 Plot (ramp) |
| `my_list` | `list[float]` | 📈 Plot |
| `my_tuple` | `tuple[int]` | 📈 Plot |
| `cloud_xyz` | `ndarray (4096,3) float32` | 📊 Point Cloud (XYZ) |
| `cloud_xyzrgb` | `ndarray (4096,6) float32` | 📊 Point Cloud (XYZ+RGB) |
| `tiny_img` | `ndarray (4,4,3) uint8` | 🖼️ Image (edge case) |
| `tiny_1d` | `ndarray (3,) float32` | 📈 Plot (edge case) |
| `tiny_cloud` | `ndarray (3,3) float32` | 📊 Point Cloud (edge case) |
