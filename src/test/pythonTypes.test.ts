/**
 * pythonTypes.test.ts — Unit tests for the pure type-detection module.
 *
 * These tests require no active debug session; all functions are pure.
 */

import * as assert from "assert";
import {
  basicTypeDetect,
  detectVisualizableType,
  classifyNdarray,
  classifyTensor,
  isNumericDtype,
  bytesPerElement,
} from "../utils/pythonTypes";

suite("basicTypeDetect", () => {
  test("numpy.ndarray → image", () => {
    assert.strictEqual(basicTypeDetect("numpy.ndarray"), "image");
  });
  test("PIL.Image.Image → image", () => {
    assert.strictEqual(basicTypeDetect("PIL.Image.Image"), "image");
  });
  test("list → plot", () => {
    assert.strictEqual(basicTypeDetect("list"), "plot");
  });
  test("tuple → plot", () => {
    assert.strictEqual(basicTypeDetect("tuple"), "plot");
  });
  test("unknown type → unknown", () => {
    assert.strictEqual(basicTypeDetect("MyCustomClass"), "unknown");
  });
});

suite("classifyNdarray", () => {
  test("(H,W) grayscale → image", () => {
    assert.strictEqual(classifyNdarray([480, 640], "uint8"), "image");
  });
  test("(H,W,3) → image", () => {
    assert.strictEqual(classifyNdarray([480, 640, 3], "uint8"), "image");
  });
  test("(H,W,4) → image", () => {
    assert.strictEqual(classifyNdarray([100, 100, 4], "float32"), "image");
  });
  test("(N,) → plot", () => {
    assert.strictEqual(classifyNdarray([1000], "float32"), "plot");
  });
  test("(N,3) point cloud → pointcloud", () => {
    assert.strictEqual(classifyNdarray([5000, 3], "float32"), "pointcloud");
  });
  test("(N,6) XYZRGB → pointcloud", () => {
    assert.strictEqual(classifyNdarray([1000, 6], "float32"), "pointcloud");
  });
  test("unknown shape → unknown", () => {
    assert.strictEqual(classifyNdarray([2, 3, 5], "float32"), "unknown");
  });
});

suite("classifyTensor", () => {
  test("(N,) → plot", () => {
    assert.strictEqual(classifyTensor([256]), "plot");
  });
  test("(C,H,W) C=3 → image", () => {
    assert.strictEqual(classifyTensor([3, 480, 640]), "image");
  });
  test("(H,W) → image", () => {
    assert.strictEqual(classifyTensor([224, 224]), "image");
  });
});

suite("isNumericDtype", () => {
  test("uint8 → true", () => assert.ok(isNumericDtype("uint8")));
  test("float32 → true", () => assert.ok(isNumericDtype("float32")));
  test("bool → true", () => assert.ok(isNumericDtype("bool")));
  test("str → false", () => assert.ok(!isNumericDtype("str")));
  test("null → true (assume numeric)", () => assert.ok(isNumericDtype(null)));
});

suite("bytesPerElement", () => {
  test("uint8 → 1", () => assert.strictEqual(bytesPerElement("uint8"), 1));
  test("float32 → 4", () => assert.strictEqual(bytesPerElement("float32"), 4));
  test("float64 → 8", () => assert.strictEqual(bytesPerElement("float64"), 8));
  test("unknown → null", () => assert.strictEqual(bytesPerElement("bfloat16"), null));
});
