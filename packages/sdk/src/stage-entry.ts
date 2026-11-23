import { stageRuntime } from "./client.ts";

/*
 * `import "@infinitegamer/sdk/stage";` turns on `IG.stage` in the npm build. It's opt-in so games that aren't
 * stage games don't ship the stage client; bundlers still split it into its own lazy chunk.
 */
stageRuntime.load ??= () => import("./stage.ts");
