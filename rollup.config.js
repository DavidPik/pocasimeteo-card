import resolve from "@rollup/plugin-node-resolve";

export default {
  input: "src/pocasimeteo-card.js",
  output: {
    file: "dist/pocasimeteo-card.js",
    format: "esm",
  },
  plugins: [
    resolve(),
  ]
};
