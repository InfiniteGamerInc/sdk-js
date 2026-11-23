// @vitest-environment node
/// <reference types="node" />
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

/** The CDN build loads before every game in the feed, so it has a hard budget. */
const IIFE_GZIP_BUDGET = 10 * 1024;
const ESM_GZIP_BUDGET = 12 * 1024;
const ROOM_GZIP_BUDGET = 4 * 1024;
const CLIPS_GZIP_BUDGET = 2 * 1024;
const STAGE_GZIP_BUDGET = 3 * 1024;
const MOCK_GZIP_BUDGET = 6 * 1024;
const CONNECTED_GZIP_BUDGET = 5 * 1024;

/**
 * What loads up front: the entry plus the chunks it imports statically. npm builds split dynamic imports into
 * their own chunks, like tsup does, so those don't count.
 */
async function bundle(entry: string, format: "iife" | "esm") {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(`../src/${entry}`, import.meta.url))],
    bundle: true,
    minify: true,
    format,
    splitting: format === "esm",
    outdir: "out",
    target: "es2020",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  const outputs = result.metafile.outputs;
  const seen = new Set<string>();
  const visit = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    for (const i of outputs[path]!.imports) if (i.kind === "import-statement" && outputs[i.path]) visit(i.path);
  };
  visit(Object.entries(outputs).find(([, o]) => o.entryPoint)![0]);
  const files = result.outputFiles.filter((f) => [...seen].some((p) => f.path.replaceAll("\\", "/").endsWith(p)));
  const code = Buffer.concat(files.map((f) => f.contents));
  return { gzip: gzipSync(code, { level: 9 }).length, inputs: [...seen].flatMap((p) => Object.keys(outputs[p]!.inputs)) };
}

describe("bundle size", () => {
  it(`keeps the CDN build under ${IIFE_GZIP_BUDGET / 1024} KB gzipped`, async () => {
    const { gzip } = await bundle("global.ts", "iife");
    expect(gzip).toBeLessThan(IIFE_GZIP_BUDGET);
  });

  it(`keeps the npm build under ${ESM_GZIP_BUDGET / 1024} KB gzipped, minified`, async () => {
    const { gzip } = await bundle("index.ts", "esm");
    expect(gzip).toBeLessThan(ESM_GZIP_BUDGET);
  });

  it("never bundles Zod or the Zod-based protocol modules", async () => {
    for (const entry of ["global.ts", "multiplayer.global.ts", "clips.global.ts", "stage.global.ts", "mock.global.ts", "connected.global.ts"]) {
      const { inputs } = await bundle(entry, "iife");
      expect(inputs.filter((i) => /node_modules[\\/]zod|protocol[\\/]src[\\/](bridge|realtime)\.ts/.test(i))).toEqual([]);
    }
  });

  it(`loads the room client separately, under ${ROOM_GZIP_BUDGET / 1024} KB gzipped`, async () => {
    const core = await bundle("global.ts", "iife");
    expect(core.inputs.filter((i) => i.endsWith("room.ts"))).toEqual([]);
    const { gzip } = await bundle("multiplayer.global.ts", "iife");
    expect(gzip).toBeLessThan(ROOM_GZIP_BUDGET);
  });

  it(`loads the clip recorder separately, under ${CLIPS_GZIP_BUDGET / 1024} KB gzipped`, async () => {
    for (const entry of ["global.ts", "index.ts"] as const) {
      const core = await bundle(entry, entry === "index.ts" ? "esm" : "iife");
      expect(core.inputs.filter((i) => /clips\.ts$/.test(i))).toEqual([]);
    }
    const { gzip } = await bundle("clips.global.ts", "iife");
    expect(gzip).toBeLessThan(CLIPS_GZIP_BUDGET);
  });

  it(`loads the stage client separately, under ${STAGE_GZIP_BUDGET / 1024} KB gzipped`, async () => {
    for (const entry of ["global.ts", "index.ts"] as const) {
      const core = await bundle(entry, entry === "index.ts" ? "esm" : "iife");
      expect(core.inputs.filter((i) => /stage\.ts$/.test(i))).toEqual([]);
    }
    const { gzip } = await bundle("stage.global.ts", "iife");
    expect(gzip).toBeLessThan(STAGE_GZIP_BUDGET);
  });

  it(`loads mock mode separately, under ${MOCK_GZIP_BUDGET / 1024} KB gzipped`, async () => {
    for (const entry of ["global.ts", "index.ts"] as const) {
      const core = await bundle(entry, entry === "index.ts" ? "esm" : "iife");
      expect(core.inputs.filter((i) => /mock\.ts$/.test(i))).toEqual([]);
    }
    const { gzip } = await bundle("mock.global.ts", "iife");
    expect(gzip).toBeLessThan(MOCK_GZIP_BUDGET);
  });

  it(`loads connected mode separately, under ${CONNECTED_GZIP_BUDGET / 1024} KB gzipped`, async () => {
    for (const entry of ["global.ts", "index.ts"] as const) {
      const core = await bundle(entry, entry === "index.ts" ? "esm" : "iife");
      expect(core.inputs.filter((i) => /connected\.ts$/.test(i))).toEqual([]);
    }
    const { gzip } = await bundle("connected.global.ts", "iife");
    expect(gzip).toBeLessThan(CONNECTED_GZIP_BUDGET);
  });
});
