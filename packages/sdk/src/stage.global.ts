import { watch } from "./stage.ts";

/* CDN chunk loaded by `ig.global.js` on the first `IG.stage.watch()` call. */
(globalThis as unknown as { __igstage?: unknown }).__igstage = { watch };
