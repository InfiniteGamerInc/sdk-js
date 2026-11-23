# Infinite Gamer SDK for JavaScript

The JavaScript and TypeScript SDK for [Infinite Gamer](https://infinitegamer.net): player accounts, cloud saves, leaderboards, achievements, friends, matchmaking, realtime rooms, turn-based matches, remote config, and analytics for web games, whether they're published in the Infinite Gamer feed or hosted on your own site.

```sh
npm install @infinitegamer/sdk
```

```ts
import { IG } from "@infinitegamer/sdk";

await IG.init();
IG.ready();
await IG.leaderboards.submit("high-score", 1280);
```

Start with the [SDK docs](https://infinitegamer.net/docs/sdk/) and the [package README](packages/sdk/README.md).

## Packages

| Package | What it is |
| --- | --- |
| [`@infinitegamer/sdk`](packages/sdk) | The SDK games install: npm (ESM) and a CDN script that defines `IG`. No dependencies, under 10 KB gzipped. |
| [`@infinitegamer/protocol`](packages/protocol) | The protocols the SDK speaks with Infinite Gamer: the `postMessage` bridge, the realtime room protocol, error codes, locales, and limits, as Zod schemas. The SDK bundles the parts it needs. Not published to npm yet. |

## Development

Node 22 or later.

```sh
npm ci
npm run check # lint, typecheck, tests, build
```

`npm test` runs the SDK tests in happy-dom, including a bundle-size budget. `npm run build -w @infinitegamer/sdk` writes `packages/sdk/dist/`.

Issues and pull requests are welcome. Changes to the bridge or realtime protocol also need a platform release before games can use them, so open an issue first for those.

## License

[MIT](LICENSE). The license covers the code; it doesn't grant rights to the Infinite Gamer name or logo, so a fork should use its own name.
