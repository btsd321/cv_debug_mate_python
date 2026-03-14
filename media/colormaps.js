/**
 * colormaps.js — Colormap lookup tables for the image viewer.
 *
 * Exposed as window.COLORMAPS[name](t) where t ∈ [0, 1].
 * Returns [r, g, b] in [0, 255].
 */
window.COLORMAPS = {
  gray: (t) => { const v = Math.round(t * 255); return [v, v, v]; },

  jet: (t) => [
    Math.min(255, Math.max(0, Math.round(255 * (1.5 - Math.abs(t * 4 - 3))))),
    Math.min(255, Math.max(0, Math.round(255 * (1.5 - Math.abs(t * 4 - 2))))),
    Math.min(255, Math.max(0, Math.round(255 * (1.5 - Math.abs(t * 4 - 1))))),
  ],

  hot: (t) => [
    Math.min(255, Math.round(t * 3 * 255)),
    Math.min(255, Math.max(0, Math.round((t * 3 - 1) * 255))),
    Math.min(255, Math.max(0, Math.round((t * 3 - 2) * 255))),
  ],

  // Viridis and Plasma use sampled lookup tables (64 stops)
  viridis: makeLUT([
    [68,1,84],[72,27,111],[62,74,137],[49,104,142],[38,130,142],
    [31,158,137],[53,183,121],[109,205,89],[180,222,44],[253,231,37],
  ]),

  plasma: makeLUT([
    [13,8,135],[75,3,161],[125,3,168],[168,34,150],[203,70,121],
    [229,107,93],[245,144,66],[253,184,45],[252,223,34],[240,249,33],
  ]),
};

function makeLUT(stops) {
  return (t) => {
    const n = stops.length - 1;
    const i = Math.min(n - 1, Math.floor(t * n));
    const f = t * n - i;
    const a = stops[i];
    const b = stops[i + 1];
    return [
      Math.round(a[0] + f * (b[0] - a[0])),
      Math.round(a[1] + f * (b[1] - a[1])),
      Math.round(a[2] + f * (b[2] - a[2])),
    ];
  };
}
