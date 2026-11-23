import { connect, matchmake } from "./room.ts";

/* CDN chunk loaded by `ig.global.js` on the first `IG.multiplayer` call. */
(globalThis as unknown as { __igmultiplayer?: unknown }).__igmultiplayer = { connect, matchmake };
