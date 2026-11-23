# @infinitegamer/sdk

The SDK for web games on [Infinite Gamer](https://infinitegamer.net), whether they're published in the feed or hosted on your own site. Players sign in with one Infinite Gamer account, and your game gets cloud saves, leaderboards, achievements, friends, matchmaking, realtime rooms, turn-based matches, remote config, and analytics, with no backend to run. No dependencies, under 10 KB gzipped, MIT licensed.

```sh
npm install @infinitegamer/sdk
```

```ts
import { IG } from "@infinitegamer/sdk";

await IG.init();
IG.on("pause", () => game.pause());
IG.on("resume", () => game.resume());
IG.ready();

await IG.storage.set("progress", { level: 4 });
await IG.leaderboards.submit("high-score", 1280);
await IG.achievements.unlock("first-win");
IG.analytics.track("level_complete", { level: 4 });

const room = await IG.multiplayer.matchmake({ mode: "duel" });
room.send({ x, y });
```

Or with a script tag, which defines a global `IG`:

```html
<script src="https://cdn.jsdelivr.net/npm/@infinitegamer/sdk@0/dist/ig.global.js"></script>
```

## Where it runs

- **In the Infinite Gamer feed and on your game page**, the SDK talks to the platform through a sandboxed bridge. Stage games and player feedback work only there, and so will ads and in-app purchases (Coming soon).
- **On your own site**, pass your game's id (the **Client ID** under **Settings → Hosting elsewhere** in Studio) and register the site's origin there:

  ```ts
  await IG.init({ gameId: "your-game-id" });
  const { signedIn, player } = await IG.player.signIn(); // "Sign in with Infinite Gamer" in a popup
  ```

  Players are guests in the browser until they sign in, then they keep the same progress they have in the feed. Your game never sees their email or how they signed in.

- **Anywhere else** (your dev server, tests, or no `gameId`), the SDK runs in mock mode: a fake player, saves in `localStorage`, and analytics in the console. Nothing to configure.

**Docs:** [infinitegamer.net/docs/sdk](https://infinitegamer.net/docs/sdk/) · [Game services](https://infinitegamer.net/docs/concepts/game-services/) · [Hosting elsewhere](https://infinitegamer.net/docs/guides/hosting-elsewhere/)

## License

MIT
