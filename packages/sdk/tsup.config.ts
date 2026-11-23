import { defineConfig } from "tsup";

// The protocol is bundled in, but only its Zod-free modules (errors, limits, locales): Zod stays out of game bundles.
export default defineConfig([
  {
    entry: { index: "src/index.ts", clips: "src/clips-entry.ts", stage: "src/stage-entry.ts" },
    format: ["esm"],
    // Inline the protocol types: the package isn't published, so published typings can't import it.
    dts: {
      compilerOptions: {
        paths: { "@infinitegamer/protocol/*": ["../protocol/src/*.ts"] },
      },
    },
    sourcemap: true,
    clean: true,
    target: "es2020",
    noExternal: [/^@infinitegamer\//],
  },
  {
    entry: {
      ig: "src/global.ts",
      "ig.multiplayer": "src/multiplayer.global.ts",
      "ig.clips": "src/clips.global.ts",
      "ig.stage": "src/stage.global.ts",
      "ig.mock": "src/mock.global.ts",
      "ig.connected": "src/connected.global.ts",
    },
    format: ["iife"],
    minify: true,
    sourcemap: true,
    target: "es2020",
    noExternal: [/^@infinitegamer\//],
    outExtension: () => ({ js: ".global.js" }),
  },
]);
