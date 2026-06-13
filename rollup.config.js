import { terser } from "@rollup/plugin-terser";

export default {
  input: "src/pocasimeteo-card.js",
  output: {
    file: "dist/pocasimeteo-card.js",
    format: "es"
  },
  plugins: [terser()]
};
