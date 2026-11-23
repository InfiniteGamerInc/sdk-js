# packages/protocol: agent guide

`@infinitegamer/protocol`: the wire protocols a game speaks with Infinite Gamer. The SDK and the platform (the shell, the api, and the realtime service) both import these schemas, so they can't drift. Exported as TypeScript source (`"exports": { ".": "./src/index.ts", "./*": "./src/*.ts" }`); consumers bundle it. MIT licensed. Not published to npm yet: the SDK bundles what it needs, and the platform uses this repository as a git submodule.

## Files

| File | What it defines |
| --- | --- |
| `src/bridge.ts` | The SDK bridge: envelope, `bridgeMethods`, `bridgeNotifications`, `bridgeEvents`, `BRIDGE_VERSION`, `TRUSTED_SHELL_ORIGINS` |
| `src/realtime.ts` | The realtime room protocol on `/rt` and its close codes, room tickets, stage games, matchmaking, turn-based matches, friends as games see them, resolved remote config |
| `src/limits.ts` | Limits games run into: `SDK_LIMITS`, `CLIP_LIMITS`, `STAGE_LIMITS`, `REALTIME_LIMITS`, `MATCHMAKING_LIMITS`, `MATCH_LIMITS`. The platform's `LIMITS` composes these with its own |
| `src/errors.ts` | `ERROR_CODES`, `IgError` |
| `src/locales.ts` | `LOCALES`, `RTL_LOCALES`, `LOCALE_NAMES`, locale negotiation |
| `src/testing.ts` | Test helpers, not part of `index.ts`: `createWindowPair` (a fake shell and game window with browser-like `postMessage`), `deliver`, `flushMessages`. Both sides of the bridge test with them |

## Run

```sh
npm run typecheck -w @infinitegamer/protocol
```

The SDK's `test/protocol-sync.test.ts` checks the SDK's hand-written types and constants against these schemas.

## Conventions

- Imports use the `.ts` extension. Only `zod` as a dependency; no Node or DOM APIs at module top level, since the SDK bundles this package for browsers and the platform imports it on servers.
- `errors.ts`, `locales.ts`, and `limits.ts` stay free of Zod: the SDK imports them at runtime, and Zod would triple its CDN build. The SDK only imports types from `bridge.ts` and `realtime.ts`.
- Write limits as literal numbers (`16_384`, not `16 * 1024`): esbuild keeps objects with arithmetic in bundles that don't use them.
- Add `.meta({ description })` to fields that appear in the generated reference at [infinitegamer.net/docs/reference](https://infinitegamer.net/docs/reference/bridge/).
- Prefer additive changes. A change old SDKs can't handle means bumping `BRIDGE_VERSION` (or `REALTIME_PROTOCOL_VERSION`), and the platform has to accept both versions while games update.
- A new bridge method lands here first, then in the platform, then in the SDK; see the root `AGENTS.md`.
