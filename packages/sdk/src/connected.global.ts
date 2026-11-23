import { ConnectedBackend } from "./connected.ts";

/* CDN chunk loaded by `ig.global.js` when a game on its own site passes `gameId` to `init()` (connected mode). */
(globalThis as unknown as { __igconnected?: unknown }).__igconnected = { ConnectedBackend };
