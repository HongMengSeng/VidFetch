import { defineConfig } from "tsdown";

export default defineConfig({
  exports: true,
  platform: "browser",
  outDir: "build",
  format: "cjs",
  deps: {
    alwaysBundle: [/.*/],
    onlyBundle: false,
    neverBundle: ["electron"],
  },
  minify: true,
  sourcemap: true,
});
