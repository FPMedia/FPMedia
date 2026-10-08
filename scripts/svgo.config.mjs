// svgo settings for the README art: keep viewBox and size, 1-decimal paths, strip editor metadata and comments.
// Keeps the ids of the handwriting and stand-in arrow groups so the arrow can be swapped for Henry's scan later.
export default {
  multipass: true,
  floatPrecision: 1,
  plugins: [
    { name: "preset-default", params: { overrides: { removeViewBox: false, cleanupIds: { preservePrefixes: ["arrow-", "handwriting-"] }, convertPathData: { floatPrecision: 1, makeArcs: false } } } },
    { name: "removeAttrs", params: { attrs: ["data-.*", "inkscape:.*", "sodipodi:.*"] } },
  ],
};
