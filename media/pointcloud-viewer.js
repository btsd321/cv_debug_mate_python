/**
 * pointcloud-viewer.js — Front-end logic for the 3D Point Cloud Viewer.
 *
 * Uses Three.js + OrbitControls for interactive 3D rendering.
 * Supports colour-by-axis gradient, per-point RGB, adjustable point size,
 * save PLY, and viewport sync.
 *
 * @typedef {import('../src/pointCloud/pointCloudProvider').PointCloudData} PointCloudData
 */

(function () {
  "use strict";

  const vscode = acquireVsCodeApi();

  /** @type {PointCloudData} */
  let data = window.__matrixViewer.initData;

  let renderer, scene, camera, controls, points;

  const container = document.getElementById("canvas-container");
  const selColorAxis = document.getElementById("sel-coloraxis");
  const rngPointSize = document.getElementById("rng-pointsize");
  const btnReset = document.getElementById("btn-reset");
  const btnSavePly = document.getElementById("btn-save-ply");
  const infoLabel = document.getElementById("info-label");

  function init() {
    infoLabel.textContent = `${data.pointCount} points`;

    // Three.js setup
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e1e1e);

    camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.001,
      10000
    );
    camera.position.set(0, 0, 5);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.addEventListener("change", () => broadcastViewport());

    buildPoints(data, "xyz");
    animate();

    selColorAxis.addEventListener("change", () => {
      updateColors(selColorAxis.value);
    });
    rngPointSize.addEventListener("input", () => {
      if (points) {
        points.material.size = parseFloat(rngPointSize.value) * 0.01;
      }
    });
    btnReset.addEventListener("click", resetCamera);
    btnSavePly.addEventListener("click", savePly);

    window.addEventListener("resize", onResize);
  }

  function buildPoints(d, colorMode) {
    if (points) { scene.remove(points); }

    const n = d.pointCount;
    const positions = new Float32Array(d.xyzValues);
    const colors = new Float32Array(n * 3);

    fillColors(colors, d, colorMode);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingBox();

    const material = new THREE.PointsMaterial({
      size: 0.02,
      vertexColors: true,
      sizeAttenuation: true,
    });

    points = new THREE.Points(geometry, material);
    scene.add(points);

    // Centre camera on bounding box
    const bbox = geometry.boundingBox;
    const centre = new THREE.Vector3();
    bbox.getCenter(centre);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    camera.position.set(centre.x, centre.y, centre.z + maxDim * 2);
    controls.target.copy(centre);
    controls.update();
  }

  function fillColors(colors, d, mode) {
    const n = d.pointCount;
    const b = d.bounds;

    if (mode === "xyz" && d.rgbValues && d.rgbValues.length === n * 3) {
      for (let i = 0; i < n * 3; i++) {
        colors[i] = d.rgbValues[i];
      }
      return;
    }

    const axisIdx = mode === "x" ? 0 : mode === "y" ? 1 : 2;
    const axisMin = mode === "x" ? b.xMin : mode === "y" ? b.yMin : b.zMin;
    const axisMax = mode === "x" ? b.xMax : mode === "y" ? b.yMax : b.zMax;

    for (let i = 0; i < n; i++) {
      const val = d.xyzValues[i * 3 + axisIdx];
      const t = axisMax > axisMin ? (val - axisMin) / (axisMax - axisMin) : 0.5;
      const [r, g, bl] = jetColormap(t);
      colors[i * 3] = r / 255;
      colors[i * 3 + 1] = g / 255;
      colors[i * 3 + 2] = bl / 255;
    }
  }

  function updateColors(mode) {
    if (!points) { return; }
    const colors = new Float32Array(data.pointCount * 3);
    fillColors(colors, data, mode);
    points.geometry.attributes.color.array.set(colors);
    points.geometry.attributes.color.needsUpdate = true;
  }

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  function resetCamera() {
    buildPoints(data, selColorAxis.value);
  }

  function onResize() {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  }

  function broadcastViewport() {
    vscode.postMessage({
      type: "syncViewport",
      cameraPosition: camera.position.toArray(),
      cameraTarget: controls.target.toArray(),
    });
  }

  function savePly() {
    const lines = ["ply", "format ascii 1.0", `element vertex ${data.pointCount}`];
    lines.push("property float x", "property float y", "property float z");
    if (data.rgbValues) {
      lines.push("property uchar red", "property uchar green", "property uchar blue");
    }
    lines.push("end_header");

    for (let i = 0; i < data.pointCount; i++) {
      let row = `${data.xyzValues[i * 3].toFixed(6)} ${data.xyzValues[i * 3 + 1].toFixed(6)} ${data.xyzValues[i * 3 + 2].toFixed(6)}`;
      if (data.rgbValues) {
        row += ` ${Math.round(data.rgbValues[i * 3] * 255)} ${Math.round(data.rgbValues[i * 3 + 1] * 255)} ${Math.round(data.rgbValues[i * 3 + 2] * 255)}`;
      }
      lines.push(row);
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.varName}.ply`;
    a.click();
    URL.revokeObjectURL(url);
  }

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg.type === "update" && msg.data) {
      data = msg.data;
      infoLabel.textContent = `${data.pointCount} points`;
      buildPoints(data, selColorAxis.value);
    } else if (msg.type === "syncViewport" && msg.cameraPosition) {
      camera.position.fromArray(msg.cameraPosition);
      controls.target.fromArray(msg.cameraTarget);
      controls.update();
    }
  });

  // Simple jet colormap helper
  function jetColormap(t) {
    const r = Math.min(255, Math.max(0, Math.round(255 * (1.5 - Math.abs(t * 4 - 3)))));
    const g = Math.min(255, Math.max(0, Math.round(255 * (1.5 - Math.abs(t * 4 - 2)))));
    const b = Math.min(255, Math.max(0, Math.round(255 * (1.5 - Math.abs(t * 4 - 1)))));
    return [r, g, b];
  }

  init();
})();
