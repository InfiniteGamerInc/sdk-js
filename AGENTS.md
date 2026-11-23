# sdk-js: agent guide

The public JavaScript SDK for Infinite Gamer, a publisher platform for web games at infinitegamer.net. MIT licensed. The platform itself (shell, api, realtime service, docs) is a separate private repository that includes this one as a git submodule at `sdk/`.

## Layout

| Path | What it is |
| --- | --- |
| `packages/sdk` | `@infinitegamer/sdk`, published to npm and served from CDNs. See its `AGENTS.md`. |
| `packages/protocol` | `@infinitegamer/protocol`: the bridge and realtime protocols as Zod schemas, plus errors, locales, and game-facing limits. The SDK bundles it; the platform imports it as TypeScript source. See its `AGENTS.md`. |

## Commands

| Command | What it does |
| --- | --- |
| `npm ci` | Install |
| `npm run check` | Lint, typecheck, tests, build (what CI runs) |
| `npm run build -w @infinitegamer/sdk` | Build the SDK into `packages/sdk/dist/` |
| `npm test` | Vitest; the SDK project runs in happy-dom |

## Conventions

- Node 22 or later, npm workspaces, TypeScript strict. Packages export TypeScript source; only the SDK has a build (tsup).
- Imports between TypeScript files use the `.ts` extension.
- **Protocol first.** A new bridge method, notification, or event goes into `packages/protocol/src/bridge.ts`, then the SDK module (with mock-mode behavior and TSDoc), then the platform implements the shell and API side after bumping the submodule. Additive changes only, unless `BRIDGE_VERSION` changes.
- **TSDoc on every SDK export.** The platform generates the API reference from it and fails its docs check on undocumented exports.
- **No Zod in the SDK bundle.** The SDK imports only the Zod-free protocol modules at runtime; `packages/sdk/test/size.test.ts` enforces this and the size budgets.
- Nothing here may depend on the platform repository. Checks that need platform code (the manifest schema, the platform's origin) live there.

## Security

- Games never see player session tokens. In the feed the SDK talks only to the shell, over `postMessage` with origin checks on both sides (`TRUSTED_SHELL_ORIGINS`). On a developer's own site (connected mode) it holds a short-lived token scoped to one game and one origin.
- Don't log tokens, and don't widen `TRUSTED_SHELL_ORIGINS`.
