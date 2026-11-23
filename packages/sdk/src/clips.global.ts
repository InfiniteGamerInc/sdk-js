import { record } from "./clips.ts";

/* CDN chunk loaded by `ig.global.js` on the first `IG.clips.record` call. */
(globalThis as unknown as { __igclips?: unknown }).__igclips = { record };
