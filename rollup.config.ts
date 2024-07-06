import { defineConfig } from "rollup";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import del from "rollup-plugin-delete";

export default defineConfig([
  {
    input: "src/main.ts",
    output: {
      dir: "dist",
      format: "esm",
      plugins: [terser()],
    },
    external: [/node_modules/],
    plugins: [typescript(), nodeResolve(), del({ targets: "dist/*" })],
  },
]);
