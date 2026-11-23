import { createWindowPair, type WindowPair } from "@infinitegamer/protocol/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IgError, createClient, type IgClient, type StageStatus } from "../src/index.ts";
import "../src/stage-entry.ts";

const SHELL = "https://infinitegamer.net";
const GAME = "https://my-game.infinitegamer.games";
const PLAYER = { id: "p_me", displayName: "Ada", avatarUrl: null, isGuest: false, locale: "en" as const };
const HANDSHAKE = {
  bridgeVersion: 1,
  shellOrigin: SHELL,
  gameId: "game_1",
  environment: "production",
  player: PLAYER,
  muted: false,
  paused: false,
  features: { multiplayer: true, ads: false, payments: false },
};
const RULES = { maxTurnSeconds: 60, readyCheckSeconds: 10, idleTimeoutSeconds: 20, maxQueueLength: 100, allowGuests: true };

function status(overrides: Partial<StageStatus> = {}): StageStatus {
  return {
    role: "viewer",
    position: null,
    waitSeconds: null,
    queueLength: 1,
    viewers: 5,
    current: { player: { id: "p_other", name: "Bo" }, turn: 3, phase: "playing", startedAt: 1_000, endsAt: 61_000 },
    lastTurn: null,
    latest: { state: { x: 1 }, at: 1_500, seq: 7 },
    readyCheck: null,
    rules: RULES,
    now: Date.now() + 10_000,
    ...overrides,
  };
}

type Request = { id: string; method: string; params: Record<string, unknown> };

interface Shell extends WindowPair {
  client: IgClient;
  requests: Request[];
  notifications: Array<{ method: string; params: unknown }>;
  event(event: string, data: unknown): void;
}

function shell(answer: (msg: Request) => unknown = () => ({})): Shell {
  const pair = createWindowPair({ shellUrl: `${SHELL}/play`, gameUrl: `${GAME}/index.html?ig_shell=${encodeURIComponent(SHELL)}` });
  const h: Shell = {
    ...pair,
    client: createClient({ window: pair.game, timeoutMs: 1000 }),
    requests: [],
    notifications: [],
    event: (event, data) => pair.game.postMessage({ ig: 1, kind: "event", event, data }, GAME),
  };
  pair.shell.addEventListener("message", (e) => {
    const msg = (e as MessageEvent).data as Request & { kind: string };
    if (msg.kind === "notify") return void h.notifications.push({ method: msg.method, params: msg.params });
    h.requests.push(msg);
    const result = msg.method === "handshake" ? HANDSHAKE : answer(msg);
    pair.game.postMessage({ ig: 1, kind: "response", id: msg.id, ok: true, result }, GAME);
  });
  return h;
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
let h: Shell | null = null;
const mocks: IgClient[] = [];

afterEach(() => {
  h?.client.destroy();
  h = null;
  for (const c of mocks.splice(0)) c.destroy();
  vi.useRealTimers();
});

describe("IG.stage in the shell", () => {
  it("starts as a viewer with the latest snapshot, and follows the shell's stage events", async () => {
    h = shell((msg) => (msg.method === "stage.watch" ? status() : msg.method === "stage.join" ? { role: "waiting", position: 2 } : {}));
    const stage = await h.client.stage.watch<{ x: number }>();
    expect(await h.client.stage.watch()).toBe(stage);
    expect(h.requests.filter((r) => r.method === "stage.watch")).toHaveLength(1);
    expect(stage).toMatchObject({ role: "viewer", viewers: 5, current: { player: { name: "Bo" } } });
    expect(stage.latest()).toEqual({ state: { x: 1 }, at: 1_500, seq: 7 });
    expect(Math.abs(stage.serverNow() - (Date.now() + 10_000))).toBeLessThan(200);

    const seen: string[] = [];
    stage.on("state", (s) => seen.push(`state:${s.state.x}`));
    stage.on("turnEnd", (e) => seen.push(`end:${e.reason}:${e.you}`));
    stage.on("turnStart", (e) => seen.push(`start:${e.player.id}:${e.you}`));

    h.event("stage.state", { state: { x: 2 }, at: 1_600, seq: 8 });
    h.event("stage.viewers", { count: 9, queueLength: 2 });
    await tick();
    expect(stage.latest()?.state).toEqual({ x: 2 });
    expect(stage).toMatchObject({ viewers: 9, queueLength: 2 });

    expect(await stage.join()).toEqual({ role: "waiting", position: 2 });
    expect(stage.role).toBe("waiting");
    h.event("stage.position", { position: 1, queueLength: 1, waitSeconds: 30 });
    h.event("stage.turnEnd", { player: { id: "p_other", name: "Bo" }, turn: 3, reason: "ended", result: { score: 40 }, endedAt: 2_000 });
    h.event("stage.readyCheck", { expiresAt: 3_000 });
    await tick();
    expect(stage).toMatchObject({ waitSeconds: 30, current: null, lastTurn: { result: { score: 40 } }, readyCheck: { expiresAt: 3_000 } });
    expect(stage.latest()).toBeNull();

    await stage.ready();
    expect(h.requests.at(-1)).toMatchObject({ method: "stage.ready", params: { accept: true } });
    h.event("stage.turnStart", { player: { id: "p_me", name: "Ada" }, turn: 4, startedAt: 3_100, endsAt: 63_100 });
    h.event("stage.role", { role: "player", position: null });
    await tick();
    expect(stage).toMatchObject({ role: "player", readyCheck: null, current: { turn: 4 } });
    expect(seen).toEqual(["state:2", "end:ended:false", "start:p_me:true"]);
  });

  it("coalesces updates to the server rate, checks size, and flushes before ending the turn", async () => {
    h = shell((msg) => (msg.method === "stage.watch" ? status({ role: "player", current: null, latest: null }) : {}));
    const stage = await h.client.stage.watch<{ n: number }>();
    for (let n = 1; n <= 5; n++) stage.update({ n });
    await tick(10);
    const updates = () => h!.notifications.filter((n) => n.method === "stage.update").map((n) => (n.params as { state: { n: number } }).state.n);
    expect(updates()).toEqual([1]);
    await tick(80);
    expect(updates()).toEqual([1, 5]);
    stage.update({ n: 6 });
    await stage.endTurn({ score: 12 });
    expect(updates()).toEqual([1, 5, 6]);
    expect(h.requests.at(-1)).toMatchObject({ method: "stage.endTurn", params: { result: { score: 12 } } });
    expect(() => stage.update({ n: "x".repeat(9000) as unknown as number })).toThrow(IgError);

    h.event("stage.role", { role: "viewer", position: null });
    await tick();
    stage.update({ n: 7 });
    await tick(80);
    expect(updates()).toEqual([1, 5, 6]);
  });

  it("interpolates between buffered snapshots", async () => {
    const now = Date.now();
    h = shell((msg) => (msg.method === "stage.watch" ? status({ now, latest: null }) : {}));
    const stage = await h.client.stage.watch<{ x: number }>();
    expect(stage.sample()).toBeNull();
    h.event("stage.state", { state: { x: 0 }, at: now - 300, seq: 1 });
    h.event("stage.state", { state: { x: 10 }, at: now - 100, seq: 2 });
    await tick();
    const s = stage.sample(200)!;
    expect(s.from.state.x).toBe(0);
    expect(s.to.state.x).toBe(10);
    expect(s.t).toBeGreaterThan(0.4);
    expect(s.t).toBeLessThan(0.7);
    expect(stage.sample(0)).toMatchObject({ from: { seq: 2 }, t: 1 });
  });
});

describe("IG.stage in mock mode", () => {
  it("simulates a line, a ready check, a turn, and a replay of your turn for viewer mode", async () => {
    vi.useFakeTimers();
    const client = createClient();
    mocks.push(client);
    await client.init({ mock: { quiet: true } });
    const stage = await client.stage.watch<{ x: number }>({ mock: { otherTurnSeconds: 1, playersAhead: 1, readyCheckSeconds: 2 } });
    expect(stage.role).toBe("viewer");
    const events: string[] = [];
    stage.on("turnStart", (e) => events.push(`start:${e.you}`));
    stage.on("turnEnd", (e) => events.push(`end:${e.reason}:${e.you}`));
    stage.on("readyCheck", () => events.push("ready?"));
    const states: number[] = [];
    stage.on("state", (s) => states.push(s.state.x));

    await vi.advanceTimersByTimeAsync(10);
    expect(stage.current?.player.name).toMatch(/Mock player/);
    expect(await stage.join()).toEqual({ role: "waiting", position: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(stage.position).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(stage.readyCheck).not.toBeNull();
    await stage.ready(true);
    expect(stage.role).toBe("player");
    stage.update({ x: 1 });
    await vi.advanceTimersByTimeAsync(100);
    stage.update({ x: 2 });
    await vi.advanceTimersByTimeAsync(100);
    await stage.endTurn({ score: 3 });
    expect(stage).toMatchObject({ role: "viewer", lastTurn: { reason: "ended", result: { score: 3 } } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(states).toEqual([1, 2]);
    expect(events.slice(0, 7)).toEqual(["start:false", "end:ended:false", "start:false", "end:ended:false", "ready?", "start:true", "end:ended:true"]);
  });

  it("skips you when you miss the ready check, and plays right away when the stage is free", async () => {
    vi.useFakeTimers();
    const client = createClient();
    mocks.push(client);
    await client.init({ mock: { quiet: true } });
    const stage = await client.stage.watch({ mock: { otherTurnSeconds: 1, playersAhead: 0, readyCheckSeconds: 1 } });
    await vi.advanceTimersByTimeAsync(10);
    await stage.join();
    await vi.advanceTimersByTimeAsync(1000);
    expect(stage.readyCheck).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(stage).toMatchObject({ role: "viewer", readyCheck: null });
    expect(stage.lastTurn?.reason).not.toBe("declined");
    // The next simulated turn runs from 2.8 s to 3.8 s; the stage is free until 4.6 s.
    await vi.advanceTimersByTimeAsync(2000);
    expect(stage.current).toBeNull();
    expect(await stage.join()).toEqual({ role: "player", position: null });
    expect(stage.current?.player.id).toBe(stage.status().current?.player.id);
  });
});
