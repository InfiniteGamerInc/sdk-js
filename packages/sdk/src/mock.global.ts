import { MockBackend } from "./mock.ts";

/* CDN chunk loaded by `ig.global.js` when the game runs outside the platform (mock mode). */
(globalThis as unknown as { __igmock?: unknown }).__igmock = { MockBackend };
