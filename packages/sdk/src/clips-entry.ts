import { clipsRuntime } from "./client.ts";

/*
 * `import "@infinitegamer/sdk/clips";` turns on `IG.clips.record` in the npm build. It's opt-in so games that
 * don't record clips don't ship the recorder; bundlers still split it into its own lazy chunk.
 */
clipsRuntime.load ??= () => import("./clips.ts");
