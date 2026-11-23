# sdk: agent guide

`@infinitegamer/sdk`, MIT licensed, published publicly to npm (ESM) and as a CDN script (`dist/ig.global.js`, global `IG`). Games use it to talk to the shell over the versioned `postMessage` bridge defined in `@infinitegamer/protocol` (`packages/protocol/src/bridge.ts`).

## Entrypoints

- `src/index.ts`: the npm entry. Everything exported here is public API and appears in the generated reference at https://infinitegamer.net/docs/reference/sdk/.
- `src/global.ts`: the CDN build (IIFE); it assigns `window.IG` itself.
- `tsup.config.ts`: both builds. The protocol is bundled in (`noExternal`) so the published package has no dependencies; Zod is never bundled (see "No Zod in the bundle").

## Run and test

```sh
npm run build -w @infinitegamer/sdk
npm run typecheck -w @infinitegamer/sdk
npm test -w @infinitegamer/sdk # Vitest with happy-dom; tests in test/
```

## Conventions

- Bridge message names, params, and results come from `bridgeMethods`, `bridgeNotifications`, and `bridgeEvents` in the protocol. Adding an SDK feature end to end: add the bridge method to `packages/protocol`, add the SDK module with mock-mode behavior and TSDoc, then implement the shell and API side and write the guide in the platform repository.
- **TSDoc on every export.** The docs reference is generated from it with TypeDoc, and the platform's docs check fails on undocumented exports.
- Outside the shell the SDK runs in mock mode (test player, localStorage saves, console analytics). Keep mock behavior in step with the real bridge.
- No dependencies beyond what's bundled; the CDN build must stay small.
- Never handle player session tokens; the shell makes API calls on the game's behalf. The one exception is connected mode, where the SDK holds a game- and origin-scoped `igp_` player token, never the session.

## Docs

The guides at https://infinitegamer.net/docs/sdk/ and their type-checked samples live in the platform repository, which includes this one as a submodule and compiles the samples against `packages/sdk/src/index.ts`. A breaking API change fails the platform's checks when the submodule is bumped, so update the samples in the same change.

## SDK internals

### No Zod in the bundle

The SDK imports only the Zod-free protocol modules (`@infinitegamer/protocol/errors`, `/limits`, `/locales`) at runtime, and `import type` from `/bridge`. `bridge.ts` builds Zod schemas at import time, which would roughly triple the CDN build, so:

- `src/protocol.ts` mirrors the few bridge constants the SDK needs (`BRIDGE_VERSION`, `BRIDGE_TIMEOUT_MS`, `BRIDGE_URL_PARAMS`, `BRIDGE_INTERACTIVE_METHODS`, `TRUSTED_SHELL_ORIGINS`, the analytics name regex). `test/protocol-sync.test.ts` fails if they drift.
- Public types in `src/types.ts` are hand-written (published typings can't reference Zod). The same test file asserts each one is mutually assignable with the protocol type, so drift fails `npm run typecheck`.
- Client-side checks (`src/validate.ts`) are hand-written and mirror the schema limits. The shell re-validates everything with Zod.
- `tsup.config.ts` bundles the protocol (`noExternal`) and inlines its types into `dist/index.d.ts` through a `paths` mapping for the DTS step. `zod` isn't in `noExternal`, so an accidental import shows up as an external import (and `test/size.test.ts` fails).
- `src/global.ts` assigns `window.IG` itself (no tsup `globalName`), so the CDN global is the client, not a module namespace.
- The realtime room client (`src/room.ts`) is lazy. The npm build reaches it through `import("./room.ts")` (set in `index.ts`), so bundlers split it out. The CDN build loads `dist/ig.multiplayer.global.js` (from `src/multiplayer.global.ts`) next to `ig.global.js` on the first `IG.multiplayer` call, falling back to jsDelivr at the same version. `global.ts` imports `client.ts`, never `index.ts`, so the room client stays out of the core. `room.ts` gets everything from the core through `RoomDeps` (including `IgError` construction), so `instanceof IG.IgError` works for room errors too.
- The clip recorder (`src/clips.ts`) is lazy the same way, but opt-in on npm: `index.ts` doesn't import it (it would push the ESM build over budget), so games add `import "@infinitegamer/sdk/clips"` (`src/clips-entry.ts`, the `./clips` export), which sets `clipsRuntime.load`. The CDN build loads `dist/ig.clips.global.js` on the first `IG.clips.record()`. `global.ts` has one `chunk(name)` loader for both chunks; each chunk sets `globalThis.__ig<name>` (`__igmultiplayer`, `__igclips`). `IG.clips.share()` is a plain bridge call in the core. Without a loaded recorder, `record()` rejects with `feature_unavailable`.
- The stage client (`src/stage.ts`, `IG.stage`) is lazy and opt-in on npm the same way: `import "@infinitegamer/sdk/stage"` (`src/stage-entry.ts`, the `./stage` export) sets `stageRuntime.load`; the CDN build loads `dist/ig.stage.global.js` (`__igstage`) on the first `IG.stage.watch()`. The shell holds the stage connection, so the chunk only makes bridge calls (`StageDeps`) and turns `stage.*` events into a `Stage`: it keeps the status, a 32-snapshot buffer for `sample()`, and coalesces `update` to `STAGE_LIMITS.updatesPerSecond`. Its mock backend simulates other players' turns (replaying your last turn), the line, the ready check, and your turn. `dispatch` in `client.ts` forwards every event to listeners (no `default` that drops unknown ones), which is how the chunk subscribes with `ig.on("stage.*")`.

### Files

| File | What it does |
| --- | --- |
| `src/client.ts` | `IgClient`: connection, modules, lifecycle, events, analytics caps. Module interfaces (`StorageModule`, ...) are exported for the reference. |
| `src/transport.ts` | `BridgeTransport`: request ids, correlation, timeouts, handshake retries, origin and source filtering. |
| `src/mock.ts` | Lazy (`mock.global.ts` for the CDN). `MockBackend`: every method faked with `localStorage` (or memory), manifest from `/infinitegamer.json`. Multiplayer tickets point at `mock:`, a one-player loopback room; turn-based matches aren't mocked. |
| `src/room.ts` | Lazy realtime room client (`Room`), matchmaking polling, and the mock loopback socket. |
| `src/stage.ts` | Lazy stage client (`Stage`): status reducer (`handle`), interpolation buffer, update coalescing, shell backend over the bridge, and the mock stage. Tested in `test/stage.test.ts`. |
| `src/clips.ts` | Lazy clip recorder: `canvas.captureStream()` plus `MediaRecorder` (webm, or mp4 on Safari), limits from `CLIP_LIMITS`, stops at `maxSeconds` or near `maxBytes`. Tested with a fake `MediaRecorder` in `test/clips.test.ts`. |
| `src/connected.ts` | Lazy (`connected.global.ts` for the CDN). `ConnectedBackend`: connected mode for games on their own sites (`init({ gameId })` outside the shell). PKCE popup on `<platform>/connect` (redirect fallback when the popup is blocked), tokens, local guest saves, the bridge-method-to-REST mapping (mirrors the shell's handlers), batched custom analytics to `POST /api/v1/games/:gameId/events`. Tested with a fake `fetch` in `test/connected.test.ts`. |
| `src/launch.ts` | Reads `ig_shell`, `ig_locale`, `ig_muted` from the iframe URL (query, then fragment) once at construction. |
| `src/audio.ts` | `IG.audio.register`: suspends an `AudioContext` / pauses and mutes media elements on pause and mute. |

### Connected mode

- `init({ gameId })` outside a shell loads `connected.ts` (`connectedRuntime`, `chunk("connected")` / `__igconnected`) instead of mock mode; `mock: true` still forces mock mode. `platformOrigin` defaults to `TRUSTED_SHELL_ORIGINS[0]`.
- Errors are built with the client's factory (like `RoomDeps.error`), so `instanceof IG.IgError` holds across the CDN chunk.
- The access token stays in memory; the refresh token is `localStorage["ig:<gameId>:refresh"]` on the game's origin. Refreshes run under `navigator.locks` (`ig:<gameId>:refresh`) so tabs never spend the same rotating token (reuse ends the sign-in for every tab). A 400, 401, or 403 from the token endpoint signs the player out locally; other failures keep the token for a retry.
- Guests: saves in `localStorage["ig:<gameId>:save:<key>"]`, uploaded with `ifVersion: 0` after sign-in (a `conflict` means the cloud already has the key, and the cloud wins). `top`, `achievements.list`, and remote config work without a token; `around` is empty; the rest reject `unauthenticated`.
- `signIn()` opens the popup before any `await`, so browsers still count the tap. `leaderboards.show()` and `achievements.show()` open `<platform>/g/<gameId>/leaderboards` in a new tab (the page redirects ids to the slug; it exists once the game is live). Ads, payments, clips, stage, and `feedback.open` reject `feature_unavailable`. `player.signOut()` exists only here; the shell and mock mode reject it.

### Connection rules

- Connecting is lazy: `init()`, any request, `on()`, `audio.register()`, or a queued notification starts the handshake. Notifications are queued (max 100) until connected.
- Shell mode needs all of: an iframe (`window.parent !== window`), a parseable `ig_shell`, that origin trusted (`TRUSTED_SHELL_ORIGINS`, loopback, or `init({ trustedShellOrigins })`), and `location.ancestorOrigins[0]` matching where the browser has it. Otherwise mock mode (or `not_in_shell` with `mock: false`).
- The handshake is re-posted every 500 ms with the same id until answered; after `handshakeTimeoutMs` it falls back to mock mode (auto) or rejects `bridge_timeout`.
- Interactive methods (`BRIDGE_INTERACTIVE_METHODS`) never time out. Feature-gated modules (multiplayer, matches, ads, payments) check `ctx.features` before sending and reject `feature_unavailable` locally.
- The host side (the shell) lives in the platform repository, whose tests run real SDK clients against it end to end. `@infinitegamer/protocol/testing` has the fake window pair both sides test with.

### Size budget

`test/size.test.ts` bundles the CDN build with esbuild and fails over 10 KB gzipped (the ESM build, counting the entry and the chunks it imports statically, with dynamic imports split out like tsup does: 12 KB; the CDN room chunk: 4 KB; clips: 2 KB; stage: 3 KB; mock: 6 KB; connected: 5 KB). It also checks that neither the CDN nor the ESM core includes `stage.ts`, `clips.ts`, `mock.ts`, or `connected.ts`. With connected mode: CDN 7,865 B, connected chunk 3,957 B, mock chunk 4,433 B, stage 2,703 B, room 2,481 B, clips 840 B. Every new `ERROR_CODES` message lands in the core; features most games don't use go in a chunk.
- Mock mode (`src/mock.ts`) is lazy too: `mockRuntime.load` is `import("./mock.ts")` in `index.ts` and `chunk("mock")` (`ig.mock.global.js`, `__igmock`) in the CDN build. `client.ts` only imports its types; `IgClient.mock` reads `controls` when `backend.isMock`. `chunk()` tries the file next to `ig.global.js` first, then jsDelivr at the same version, so games that copied only `ig.global.js` still load chunks. Import `SDK_LIMITS` (or `STAGE_LIMITS` in the stage chunk), not `LIMITS`: the full limits object is about 700 bytes gzipped. Keep those small limit objects as literal numbers: esbuild treats `a * b` as possibly impure and keeps the whole object in bundles that don't use it.
