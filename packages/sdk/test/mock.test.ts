import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IG, IgError, createClient, type IgClient, type MockManifest } from "../src/index.ts";

const manifest: MockManifest = {
  leaderboards: [
    { id: "high-score", name: "High score" },
    { id: "speedrun", name: "Fastest", sort: "asc" },
  ],
  achievements: [
    { id: "first-win", name: "First win", description: "Win once", points: 10 },
    { id: "secret", name: "Secret", hidden: true, points: 50 },
  ],
};

let client: IgClient;
const clients: IgClient[] = [];
function mockClient(
  options: Parameters<IgClient["init"]>[0] = { mock: { manifest, quiet: true } },
) {
  const c = createClient();
  clients.push(c);
  return { c, ready: c.init(options) };
}

beforeEach(async () => {
  window.localStorage.clear();
  ({ c: client } = mockClient());
  await client.init();
});

afterEach(() => {
  for (const c of clients.splice(0)) c.destroy();
  vi.restoreAllMocks();
});

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(IgError);
    return (err as IgError).code;
  }
  throw new Error("Expected a rejection");
}

describe("mock mode", () => {
  it("turns on automatically in a top-level window", async () => {
    const ctx = await client.init();
    expect(ctx).toMatchObject({
      isMock: true,
      environment: "mock",
      gameId: "mock-game",
      muted: false,
      paused: false,
    });
    expect(client.isMock).toBe(true);
    expect(client.mock).not.toBeNull();
  });

  it("can be refused", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { ready } = mockClient({ mock: false });
    expect(await code(ready)).toBe("not_in_shell");
  });

  it("predicts mock mode before init", () => {
    expect(createClient().isMock).toBe(true);
    expect(IG.isMock).toBe(true);
  });

  it("fakes a developer player and an unsigned identity token", async () => {
    await expect(client.player.get()).resolves.toMatchObject({
      id: "mock-player",
      displayName: "Developer",
      isGuest: false,
    });
    const { token, expiresAt } = await client.player.identityToken();
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(atob(header as string))).toEqual({ alg: "none", typ: "JWT" });
    expect(
      JSON.parse(atob((payload as string).replace(/-/g, "+").replace(/_/g, "/"))),
    ).toMatchObject({ sub: "mock-player", iss: "mock" });
    expect(signature).toBe("");
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
  });

  it("lets you override the fake player", async () => {
    const { ready } = mockClient({
      mock: { player: { displayName: "Tester", isGuest: true }, quiet: true },
    });
    expect((await ready).player).toMatchObject({
      displayName: "Tester",
      isGuest: true,
      id: "mock-player",
    });
  });

  it("fakes sign-in and the platform screens", async () => {
    await expect(client.player.signIn()).resolves.toMatchObject({ signedIn: true, player: { id: "mock-player" } });
    const { c, ready } = mockClient({ mock: { player: { isGuest: true }, quiet: true } });
    await ready;
    await expect(c.player.signIn()).resolves.toMatchObject({ signedIn: false });
    await expect(client.leaderboards.show("high-score", { period: "all" })).resolves.toBeUndefined();
    await expect(client.achievements.show()).resolves.toBeUndefined();
    expect(await code(client.leaderboards.show(""))).toBe("bad_request");
  });
});

describe("mock storage", () => {
  it("gets, sets, lists, and deletes", async () => {
    expect(await client.storage.get("progress")).toBeNull();
    expect(await client.storage.getEntry("progress")).toEqual({ value: null, version: 0 });
    expect(await client.storage.set("progress", { level: 4 })).toEqual({ version: 1 });
    expect(await client.storage.set("progress", { level: 5 })).toEqual({ version: 2 });
    expect(await client.storage.get<{ level: number }>("progress")).toEqual({ level: 5 });
    await client.storage.set("settings", { music: false });
    const keys = await client.storage.list();
    expect(keys.map((k) => [k.key, k.version])).toEqual([
      ["progress", 2],
      ["settings", 1],
    ]);
    await client.storage.delete("progress");
    expect(await client.storage.get("progress")).toBeNull();
  });

  it("enforces ifVersion", async () => {
    await client.storage.set("slot", 1);
    expect(await code(client.storage.set("slot", 2, { ifVersion: 0 }))).toBe("conflict");
    await expect(client.storage.set("slot", 2, { ifVersion: 1 })).resolves.toEqual({ version: 2 });
    expect(await code(client.storage.set("new", 1, { ifVersion: 3 }))).toBe("conflict");
    await expect(client.storage.set("new", 1, { ifVersion: 0 })).resolves.toEqual({ version: 1 });
  });

  it("persists in localStorage across clients", async () => {
    await client.storage.set("progress", { level: 9 });
    const { c, ready } = mockClient();
    await ready;
    expect(await c.storage.get("progress")).toEqual({ level: 9 });
  });

  it("keeps saves in memory with persist: false", async () => {
    const { c, ready } = mockClient({ mock: { persist: false, quiet: true } });
    await ready;
    await c.storage.set("progress", 1);
    expect(window.localStorage.getItem("ig-mock:save:progress")).toBeNull();
    expect(await c.storage.get("progress")).toBe(1);
  });

  it("enforces the per-game key quota", async () => {
    const { c, ready } = mockClient({ mock: { persist: false, quiet: true } });
    await ready;
    for (let i = 0; i < 200; i++) await c.storage.set(`k${i}`, i);
    expect(await code(c.storage.set("one-more", 1))).toBe("quota_exceeded");
    await expect(c.storage.set("k0", "overwrite is fine")).resolves.toEqual({ version: 2 });
  });

  it("applies the same client-side limits as the shell", async () => {
    expect(await code(client.storage.set("big", "x".repeat(257 * 1024)))).toBe("payload_too_large");
  });
});

describe("mock leaderboards", () => {
  it("keeps the best score", async () => {
    expect(await client.leaderboards.submit("high-score", 100)).toEqual({
      best: 100,
      rank: 1,
      improved: true,
    });
    expect(await client.leaderboards.submit("high-score", 50)).toEqual({
      best: 100,
      rank: 1,
      improved: false,
    });
    expect(await client.leaderboards.submit("high-score", 150, { level: 2 })).toMatchObject({
      best: 150,
      improved: true,
    });
    const top = await client.leaderboards.top("high-score", { limit: 5, period: "all" });
    expect(top).toEqual([
      {
        rank: 1,
        playerId: "mock-player",
        displayName: "Developer",
        avatarUrl: null,
        score: 150,
        isCurrentPlayer: true,
      },
    ]);
    expect(await client.leaderboards.around("high-score")).toEqual(top);
  });

  it("treats lower as better for ascending boards", async () => {
    await client.leaderboards.submit("speedrun", 30_000);
    expect(await client.leaderboards.submit("speedrun", 25_000)).toMatchObject({
      best: 25_000,
      improved: true,
    });
    expect(await client.leaderboards.submit("speedrun", 40_000)).toMatchObject({
      best: 25_000,
      improved: false,
    });
  });

  it("rejects leaderboards missing from the manifest", async () => {
    expect(await code(client.leaderboards.submit("nope", 1))).toBe("unknown_leaderboard");
    expect(await code(client.leaderboards.top("nope"))).toBe("unknown_leaderboard");
  });

  it("returns empty boards before the first score", async () => {
    expect(await client.leaderboards.top("high-score")).toEqual([]);
    expect(await client.leaderboards.around("high-score", { range: 3 })).toEqual([]);
  });
});

describe("mock achievements", () => {
  it("unlocks once and lists declared achievements", async () => {
    expect(await client.achievements.unlock("first-win")).toEqual({
      unlocked: true,
      alreadyUnlocked: false,
    });
    expect(await client.achievements.unlock("first-win")).toEqual({
      unlocked: true,
      alreadyUnlocked: true,
    });
    const list = await client.achievements.list();
    expect(list.map((a) => [a.id, a.points, a.hidden, a.unlockedAt !== null])).toEqual([
      ["first-win", 10, false, true],
      ["secret", 50, true, false],
    ]);
  });

  it("rejects achievements missing from the manifest", async () => {
    expect(await code(client.achievements.unlock("nope"))).toBe("unknown_achievement");
  });
});

describe("mock manifest", () => {
  it("fetches /infinitegamer.json from the game's origin", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ leaderboards: [{ id: "daily" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      const { c, ready } = mockClient({ mock: { persist: false, quiet: true } });
      await ready;
      await expect(c.leaderboards.submit("daily", 1)).resolves.toMatchObject({ best: 1 });
      expect(await code(c.leaderboards.submit("weekly", 1))).toBe("unknown_leaderboard");
      await expect(c.mock?.manifest()).resolves.toEqual({ leaderboards: [{ id: "daily" }] });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(
        new URL("/infinitegamer.json", window.location.href).href,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("accepts any id with a warning when there's no manifest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { c, ready } = mockClient({ mock: { manifestUrl: false, persist: false, quiet: true } });
    await ready;
    await c.leaderboards.submit("anything", 1);
    await c.leaderboards.submit("anything", 2);
    await c.achievements.unlock("whatever");
    expect(warn).toHaveBeenCalledTimes(2);
    expect((await c.achievements.list()).map((a) => a.id)).toEqual(["whatever"]);
  });
});

describe("mock analytics, lifecycle, and feedback", () => {
  it("logs to the console", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { c, ready } = mockClient({ mock: { persist: false } });
    await ready;
    c.ready();
    c.gameplayStart();
    c.analytics.track("level_complete", { level: 4 });
    expect(info).toHaveBeenCalledWith(
      "[IG mock] lifecycle.ready",
      expect.objectContaining({ loadMs: expect.any(Number) }),
    );
    expect(info).toHaveBeenCalledWith("[IG mock] lifecycle.gameplayStart", {});
    expect(info).toHaveBeenCalledWith("[IG mock] analytics.track level_complete", { level: 4 });
  });

  it("stays quiet with quiet: true", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    client.analytics.track("level_complete");
    client.ready();
    expect(info).not.toHaveBeenCalled();
  });

  it("fakes feedback", async () => {
    await expect(client.feedback.open()).resolves.toEqual({ submitted: false });
    await expect(client.feedback.open({ kind: "bug" })).resolves.toEqual({ submitted: false });
    await expect(
      client.feedback.submit({ kind: "bug", body: "Stuck on level 3", context: { level: 3 } }),
    ).resolves.toEqual({
      id: "mock-feedback-1",
    });
  });
});

describe("mock events", () => {
  it("emits events through IG.mock", async () => {
    const pause = vi.fn();
    client.on("pause", pause);
    client.mock?.emit("pause", { reason: "overlay" });
    expect(pause).toHaveBeenCalledWith({ reason: "overlay" });
    expect(client.paused).toBe(true);
    client.mock?.emit("locale.change", { locale: "ko" });
    expect(client.locale).toBe("ko");
  });

  it("pauses when the tab is hidden", async () => {
    const pause = vi.fn();
    const resume = vi.fn();
    client.on("pause", pause);
    client.on("resume", resume);
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(pause).toHaveBeenCalledWith({ reason: "hidden" });
    state.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(resume).toHaveBeenCalled();
  });

  it("resets mock data", async () => {
    await client.storage.set("a", 1);
    await client.achievements.unlock("first-win");
    client.mock?.reset();
    expect(await client.storage.list()).toEqual([]);
    expect((await client.achievements.list()).every((a) => a.unlockedAt === null)).toBe(true);
  });
});

describe("mock monetization", () => {
  it("plays ads instantly and rewards rewarded ads", async () => {
    expect(await client.ads.show({ type: "interstitial" })).toEqual({ shown: true, rewarded: false });
    expect(await client.ads.show({ type: "rewarded" })).toEqual({ shown: true, rewarded: true });
  });

  it("sells mock products for free and tracks consumables", async () => {
    const products = [
      { id: "gems", name: "Gems", description: "", priceCoins: 100, type: "consumable" as const },
      { id: "no_ads", name: "No ads", description: "", priceCoins: 300, type: "non_consumable" as const },
    ];
    const { c, ready } = mockClient({ mock: { quiet: true, persist: false, products } });
    await ready;
    expect(await c.payments.catalog()).toEqual(products);
    expect(await c.payments.purchase("gems")).toEqual({ purchased: true, receipt: "mock.gems" });
    await c.payments.purchase("gems");
    await c.payments.purchase("no_ads");
    await c.payments.purchase("no_ads");
    const owned = await c.payments.entitlements();
    expect(owned.map((e) => [e.product, e.quantity])).toEqual([
      ["gems", 2],
      ["no_ads", 1],
    ]);
    expect(await c.payments.consume("gems")).toEqual({ remaining: 1 });
    expect(await code(c.payments.consume("gems", 2))).toBe("conflict");
    expect(await code(c.payments.purchase("missing"))).toBe("not_found");
  });
});

describe("mock multiplayer", () => {
  it("joins a one-player room that behaves like the realtime server", async () => {
    expect((await client.init()).features.multiplayer).toBe(true);
    const room = await client.multiplayer.join({ mode: "duel", create: { capacity: 2, metadata: { map: "a" } } });
    expect(room).toMatchObject({ you: "mock-player", isHost: true, connected: true });
    expect(room.info).toMatchObject({ mode: "duel", capacity: 2, metadata: { map: "a" }, hostId: "mock-player" });
    expect(room.info.inviteUrl).toContain(`room=${room.code}`);
    expect(room.players.map((p) => p.id)).toEqual(["mock-player"]);

    const states: unknown[] = [];
    room.on("state", (s) => states.push(s));
    expect(await room.setState("score", 1)).toBe(1);
    expect(await room.setState("score", 2, { ifVersion: 1 })).toBe(2);
    expect(await code(room.setState("score", 3, { ifVersion: 1 }))).toBe("conflict");
    expect(room.get("score")).toBe(2);
    expect(room.entry("score")).toEqual({ value: 2, version: 2 });
    await room.deleteState("score");
    expect(room.keys()).toEqual([]);
    expect(states).toHaveLength(3);

    const messages: unknown[] = [];
    room.on("message", (m) => messages.push(m));
    room.send({ hi: 1 });
    room.send({ echo: true }, { to: [room.you] });
    await room.update({ locked: true });
    expect(room.info.locked).toBe(true);
    expect(messages).toEqual([{ from: "mock-player", data: { echo: true } }]);
    expect(await code(room.kick("someone"))).toBe("not_found");

    const closed = new Promise((resolve) => room.on("close", resolve));
    room.leave();
    expect(await closed).toEqual({ code: 1000, reason: "" });
    expect(room.connected).toBe(false);
    expect(() => room.send("late")).toThrow(IgError);
    const again = await room.rejoin();
    expect(again.code).toBe(room.code);
  });

  it("matchmakes into a room, and cancels", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const pending = client.multiplayer.matchmake({ mode: "duel" });
      await vi.advanceTimersByTimeAsync(1600);
      const room = await pending;
      expect(room.info.mode).toBe("duel");
      const controller = new AbortController();
      const cancelled = client.multiplayer.matchmake({ mode: "duel", signal: controller.signal });
      controller.abort();
      await expect(cancelled).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves remote config, friends, and no turn-based matches", async () => {
    const { c, ready } = mockClient({ mock: { quiet: true, remoteConfig: { lives: 5 } } });
    await ready;
    expect(await c.remoteConfig.get("lives", 3)).toBe(5);
    expect(await c.remoteConfig.get("missing", "x")).toBe("x");
    expect(await c.remoteConfig.get("toString", 1)).toBe(1);
    expect(await c.remoteConfig.getAll()).toEqual({ values: { lives: 5 }, version: 0, overrides: [] });
    expect(await c.friends.list()).toEqual([]);
    expect(await c.friends.request("p1")).toBe("requested");
    expect(await code(c.matches.create())).toBe("feature_unavailable");
  });
});
