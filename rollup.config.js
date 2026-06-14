import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

export default {
  input: "src/pocasimeteo-card.js",
  output: {
    file: "dist/pocasimeteo-card.js",
    format: "esm"
  },
  plugins: [
    resolve(),
    commonjs()
  ]
};
