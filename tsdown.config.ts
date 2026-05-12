import { defineConfig } from "tsdown";

export default defineConfig({
  workspace: "extensions/*",
  format: ["esm", "cjs"],
  dts: {
    sourcemap: true,
  },
  exports: true,
  clean: true,
  sourcemap: true,
  shims: true,
});
