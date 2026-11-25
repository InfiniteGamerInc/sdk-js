import {
  createWindowPair,
  deliver,
  flushMessages,
  type WindowPair,
} from "@infinitegamer/protocol/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IgError, createClient, type IgClient } from "../src/index.ts";

const SHELL = "https://infinitegamer.net";
const GAME = "https://my-game.infinitegamer.games";

const PLAYER = {
  id: "p_1",
  displayName: "Ada",
  avatarUrl: null,
  isGuest: false,
  locale: "en" as const,
};
const HANDSHAKE = {
  bridgeVersion: 1,
  shellOrigin: SHELL,
  gameId: "game_1",
  environment: "production",
  player: PLAYER,
  muted: true,
  paused: false,
  features: { multiplayer: false, ads: false, payments: false },
};

type Request = {
  ig: number;
  kind: "request";
  id: string;
  method: string;
  params: Record<string, unknown>;
};
type Answer = { result: unknown } | { error: { code: string; message: string } } | undefined;

interface Harness extends WindowPair {
  client: IgClient;
  requests: Request[];
  notifications: Array<{ method: string; params: unknown }>;
  answer: (msg: Request) => Answer;
  send: (message: unknown) => void;
}

function setup(
  options: { query?: string; answer?: (msg: Request) => Answer; timeoutMs?: number } = {},
): Harness {
  const query = options.query ?? `?ig_shell=${encodeURIComponent(SHELL)}&ig_locale=de&ig_muted=1`;
  const pair = createWindowPair({
    shellUrl: `${SHELL}/play`,
    gameUrl: `${GAME}/index.html${query}`,
  });
  const h: Harness = {
    ...pair,
    client: createClient({ window: pair.game, timeoutMs: options.timeoutMs ?? 1000 }),
    requests: [],
    notifications: [],
    answer:
      options.answer ?? ((msg) => (msg.method === "handshake" ? { result: HANDSHAKE } : undefined)),
    send: (message) => pair.game.postMessage(message, GAME),
  };
  pair.shell.addEventListener("message", (event) => {
    const msg = (event as MessageEvent).data as
      Request | { kind: "notify"; method: string; params: unknown };
    if (msg.kind === "notify") {
      h.notifications.push({ method: msg.method, params: msg.params });
      return;
    }
    h.requests.push(msg);
    const out = h.answer(msg);
    if (out)
      h.send({
        ig: 1,
        kind: "response",
        id: msg.id,
        ...("result" in out ? { ok: true, result: out.result } : { ok: false, error: out.error }),
      });
  });
  return h;
}

async function rejection(promise: Promise<unknown>): Promise<IgError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(IgError);
    return err as IgError;
  }
  throw new Error("Expected a rejection");
}

let h: Harness;
afterEach(() => {
  h?.client.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("handshake", () => {
  it("handshakes with the shell origin from the URL and resolves the context", async () => {
    h = setup();
    const ctx = await h.client.init();
    expect(h.requests[0]).toMatchObject({
      ig: 1,
      kind: "request",
      method: "handshake",
      params: { bridgeVersion: 1, sdkVersion: "0.1.0" },
    });
    expect(h.shell.received[0]?.targetOrigin).toBe(SHELL);
    expect(ctx).toMatchObject({
      gameId: "game_1",
      environment: "production",
      player: PLAYER,
      locale: "en",
      muted: true,
      isMock: false,
      bridgeVersion: 1,
    });
    expect(h.client.isMock).toBe(false);
    expect(h.client.mock).toBeNull();
  });

  it("exposes the URL's locale and mute state before the handshake", () => {
    h = setup();
    expect(h.client.locale).toBe("de");
    expect(h.client.muted).toBe(true);
    expect(h.client.isMock).toBe(false);
  });

  it("connects lazily on the first call", async () => {
    h = setup({
      answer: (msg) =>
        msg.method === "handshake"
          ? { result: HANDSHAKE }
          : msg.method === "player.get"
            ? { result: PLAYER }
            : undefined,
    });
    await expect(h.client.player.get()).resolves.toEqual(PLAYER);
    expect(h.requests.map((r) => r.method)).toEqual(["handshake", "player.get"]);
  });

  it("rejects when the shell speaks another bridge version", async () => {
    h = setup({ answer: () => ({ result: { ...HANDSHAKE, bridgeVersion: 2 } }) });
    const err = await rejection(h.client.init());
    expect(err.code).toBe("bridge_version_mismatch");
    await expect(h.client.storage.get("x")).rejects.toMatchObject({
      code: "bridge_version_mismatch",
    });
  });

  it("passes on a version mismatch error from the shell", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h = setup({
      answer: () => ({ error: { code: "bridge_version_mismatch", message: "Shell speaks v2" } }),
    });
    const err = await rejection(h.client.init());
    expect(err).toMatchObject({ code: "bridge_version_mismatch", message: "Shell speaks v2" });
  });

  it("retries the handshake until the shell answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let calls = 0;
    h = setup({
      answer: (msg) =>
        msg.method === "handshake" && ++calls === 3 ? { result: HANDSHAKE } : undefined,
    });
    const ctx = h.client.init();
    await vi.advanceTimersByTimeAsync(1100);
    await expect(ctx).resolves.toMatchObject({ isMock: false });
    expect(new Set(h.requests.map((r) => r.id)).size).toBe(1);
  });

  it("falls back to mock mode when the shell never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h = setup({ answer: () => undefined });
    const ctx = h.client.init({ handshakeTimeoutMs: 2000, mock: { persist: false, quiet: true } });
    await vi.advanceTimersByTimeAsync(2100);
    await expect(ctx).resolves.toMatchObject({ isMock: true, environment: "mock" });
    expect(warn).toHaveBeenCalled();
    expect(h.client.mock).not.toBeNull();
  });

  it("rejects with bridge_timeout when mock mode is off", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h = setup({ answer: () => undefined });
    const ctx = h.client.init({ handshakeTimeoutMs: 1000, mock: false });
    const result = rejection(ctx);
    await vi.advanceTimersByTimeAsync(1100);
    expect((await result).code).toBe("bridge_timeout");
  });

  it("ignores an untrusted ig_shell and never posts to it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h = setup({ query: `?ig_shell=${encodeURIComponent("https://evil.example")}` });
    const ctx = await h.client.init({ mock: { persist: false, quiet: true } });
    expect(ctx.isMock).toBe(true);
    expect(h.shell.received).toHaveLength(0);
  });

  it("trusts extra shell origins passed to init", async () => {
    const other = "https://staging.example";
    h = setup({ query: `?ig_shell=${encodeURIComponent(other)}` });
    Object.assign(h.shell.location, { origin: other, href: `${other}/play` });
    const ctx = await h.client.init({ trustedShellOrigins: [other] });
    expect(ctx.isMock).toBe(false);
  });

  it("checks location.ancestorOrigins when the browser has it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h = setup();
    h.client.destroy();
    h.game.location.ancestorOrigins = {
      length: 1,
      0: "https://evil.example",
    } as unknown as DOMStringList;
    h.client = createClient({ window: h.game });
    expect((await h.client.init({ mock: { persist: false, quiet: true } })).isMock).toBe(true);
    expect(h.shell.received).toHaveLength(0);
  });

  it("reads launch params from the fragment too", () => {
    h = setup({ query: `#ig_shell=${encodeURIComponent(SHELL)}&ig_locale=pt-BR` });
    expect(h.client.locale).toBe("pt-BR");
    expect(h.client.isMock).toBe(false);
  });
});

describe("requests", () => {
  it("correlates responses that arrive out of order", async () => {
    const held: Request[] = [];
    h = setup({
      answer: (msg) => {
        if (msg.method === "handshake") return { result: HANDSHAKE };
        held.push(msg);
        return undefined;
      },
    });
    await h.client.init();
    const a = h.client.storage.get("a");
    const b = h.client.storage.get("b");
    await flushMessages();
    expect(held).toHaveLength(2);
    const [ra, rb] = held as [Request, Request];
    h.send({ ig: 1, kind: "response", id: rb.id, ok: true, result: { value: "B", version: 2 } });
    h.send({ ig: 1, kind: "response", id: ra.id, ok: true, result: { value: "A", version: 1 } });
    await expect(a).resolves.toBe("A");
    await expect(b).resolves.toBe("B");
  });

  it("times out unanswered requests with bridge_timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    h = setup();
    await h.client.init();
    const pending = rejection(h.client.achievements.list());
    await vi.advanceTimersByTimeAsync(1001);
    expect((await pending).code).toBe("bridge_timeout");
  });

  it("never times out interactive calls", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    h = setup();
    await h.client.init();
    let settled = false;
    void h.client.feedback.open().finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
    const req = h.requests.find((r) => r.method === "feedback.open") as Request;
    h.send({ ig: 1, kind: "response", id: req.id, ok: true, result: { submitted: true } });
    await flushMessages();
    expect(settled).toBe(true);
  });

  it("surfaces shell errors as IgError with the contract code", async () => {
    h = setup({
      answer: (msg) =>
        msg.method === "handshake"
          ? { result: HANDSHAKE }
          : { error: { code: "unknown_leaderboard", message: "No leaderboard daily" } },
    });
    const err = await rejection(h.client.leaderboards.submit("daily", 10));
    expect(err).toMatchObject({ code: "unknown_leaderboard", message: "No leaderboard daily" });
  });

  it("maps unknown error codes to internal and keeps the original", async () => {
    h = setup({
      answer: (msg) =>
        msg.method === "handshake"
          ? { result: HANDSHAKE }
          : { error: { code: "teapot", message: "?" } },
    });
    const err = await rejection(h.client.storage.list());
    expect(err.code).toBe("internal");
    expect(err.details).toEqual({ code: "teapot" });
  });
});

describe("origin filtering", () => {
  it("ignores responses from the wrong origin, the wrong window, or in the wrong shape", async () => {
    let held: Request | undefined;
    h = setup({
      answer: (msg) =>
        msg.method === "handshake" ? { result: HANDSHAKE } : ((held = msg), undefined),
    });
    await h.client.init();
    let settled = false;
    void h.client.player.get().then(() => (settled = true));
    await flushMessages();
    const id = (held as Request).id;
    const response = { ig: 1, kind: "response", id, ok: true, result: PLAYER };
    deliver(h.game, { data: response, origin: "https://evil.example", source: h.shell });
    deliver(h.game, { data: response, origin: SHELL, source: {} });
    deliver(h.game, { data: { ...response, kind: "nope" }, origin: SHELL, source: h.shell });
    deliver(h.game, { data: "hello", origin: SHELL, source: h.shell });
    await flushMessages();
    expect(settled).toBe(false);
    deliver(h.game, { data: response, origin: SHELL, source: h.shell });
    await flushMessages();
    expect(settled).toBe(true);
  });

  it("only ever posts to the shell origin", async () => {
    h = setup();
    await h.client.init();
    h.client.ready();
    h.client.analytics.track("level_complete", { level: 1 });
    await flushMessages();
    expect(h.shell.received.length).toBeGreaterThan(2);
    expect(h.shell.received.every((m) => m.targetOrigin === SHELL && m.delivered)).toBe(true);
  });
});

describe("events", () => {
  it("updates state, calls listeners, and unsubscribes", async () => {
    h = setup();
    await h.client.init();
    const paused = vi.fn();
    const off = h.client.on("pause", paused);
    h.send({ ig: 1, kind: "event", event: "pause", data: { reason: "offscreen" } });
    await flushMessages();
    expect(paused).toHaveBeenCalledWith({ reason: "offscreen" });
    expect(h.client.paused).toBe(true);
    expect(h.client.context?.paused).toBe(true);

    off();
    h.send({ ig: 1, kind: "event", event: "resume", data: {} });
    h.send({ ig: 1, kind: "event", event: "pause", data: { reason: "hidden" } });
    await flushMessages();
    expect(paused).toHaveBeenCalledTimes(1);

    h.send({ ig: 1, kind: "event", event: "unmute", data: {} });
    h.send({ ig: 1, kind: "event", event: "locale.change", data: { locale: "fr" } });
    await flushMessages();
    expect(h.client.muted).toBe(false);
    expect(h.client.locale).toBe("fr");
  });

  it("ignores malformed events and keeps going when a listener throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    h = setup();
    await h.client.init();
    const good = vi.fn();
    h.client.on("mute", () => {
      throw new Error("boom");
    });
    h.client.on("mute", good);
    h.client.on("locale.change", good);
    h.send({ ig: 1, kind: "event", event: "locale.change", data: { locale: "xx" } });
    h.send({ ig: 1, kind: "event", event: "mute", data: {} });
    await flushMessages();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("drops the cached identity token when the player changes", async () => {
    let n = 0;
    h = setup({
      answer: (msg) =>
        msg.method === "handshake"
          ? { result: HANDSHAKE }
          : {
              result: {
                token: `t${++n}`,
                expiresAt: new Date(Date.now() + 3600_000).toISOString(),
              },
            },
    });
    expect((await h.client.player.identityToken()).token).toBe("t1");
    expect((await h.client.player.identityToken()).token).toBe("t1");
    const changed = vi.fn();
    h.client.on("player.change", changed);
    h.send({
      ig: 1,
      kind: "event",
      event: "player.change",
      data: { ...PLAYER, id: "p_2", locale: "ja" },
    });
    await flushMessages();
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ id: "p_2" }));
    expect(h.client.context?.player.id).toBe("p_2");
    expect(h.client.locale).toBe("ja");
    expect((await h.client.player.identityToken()).token).toBe("t2");
  });

  it("suspends registered audio on pause and mute", async () => {
    h = setup();
    const ctx = {
      state: "running",
      suspend: vi.fn(async () => void (ctx.state = "suspended")),
      resume: vi.fn(async () => void (ctx.state = "running")),
    };
    await h.client.init();
    h.client.audio.register(ctx as unknown as AudioContext);
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
    h.send({ ig: 1, kind: "event", event: "unmute", data: {} });
    await flushMessages();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    h.send({ ig: 1, kind: "event", event: "pause", data: { reason: "ad" } });
    await flushMessages();
    expect(ctx.suspend).toHaveBeenCalledTimes(2);
  });

  it("pauses and mutes registered media elements and restores only what it changed", async () => {
    h = setup();
    await h.client.init();
    h.send({ ig: 1, kind: "event", event: "unmute", data: {} });
    await flushMessages();
    const media = {
      muted: false,
      paused: false,
      pause: vi.fn(() => void (media.paused = true)),
      play: vi.fn(async () => void (media.paused = false)),
    };
    const unregister = h.client.audio.register(media as unknown as HTMLMediaElement);
    h.send({ ig: 1, kind: "event", event: "mute", data: {} });
    h.send({ ig: 1, kind: "event", event: "pause", data: { reason: "overlay" } });
    await flushMessages();
    expect(media).toMatchObject({ muted: true, paused: true });
    h.send({ ig: 1, kind: "event", event: "unmute", data: {} });
    h.send({ ig: 1, kind: "event", event: "resume", data: {} });
    await flushMessages();
    expect(media).toMatchObject({ muted: false, paused: false });
    unregister();
    h.send({ ig: 1, kind: "event", event: "mute", data: {} });
    await flushMessages();
    expect(media.muted).toBe(false);
  });
});

describe("notifications", () => {
  it("queues lifecycle calls until the handshake, then sends them", async () => {
    h = setup();
    h.client.loadingProgress(0.5);
    h.client.ready();
    h.client.ready();
    h.client.gameplayStart();
    h.client.gameplayStart();
    h.client.gameplayStop();
    h.client.error(new Error("kaboom"));
    await h.client.init();
    await flushMessages();
    expect(h.notifications.map((n) => n.method)).toEqual([
      "lifecycle.loadingProgress",
      "lifecycle.ready",
      "lifecycle.gameplayStart",
      "lifecycle.gameplayStop",
      "lifecycle.error",
    ]);
    expect(h.notifications[1]?.params).toEqual({ loadMs: expect.any(Number) });
    expect(h.notifications[4]?.params).toMatchObject({
      message: "kaboom",
      stack: expect.any(String),
    });
  });

  it("throttles loading progress to one update per percent", async () => {
    h = setup();
    await h.client.init();
    for (let i = 0; i <= 1000; i++) h.client.loadingProgress(i / 1000);
    await flushMessages();
    const sent = h.notifications
      .filter((n) => n.method === "lifecycle.loadingProgress")
      .map((n) => (n.params as { progress: number }).progress);
    expect(sent[0]).toBe(0);
    expect(sent.at(-1)).toBe(1);
    expect(sent.length).toBeLessThanOrEqual(101);
  });

  it("drops invalid analytics events with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h = setup();
    await h.client.init();
    h.client.analytics.track("Level Complete");
    h.client.analytics.track("ok_event", { nested: { a: 1 } } as never);
    h.client.analytics.track("big", { blob: "x".repeat(5000) });
    h.client.analytics.track("level_complete", { level: 3, perfect: true, note: null });
    await flushMessages();
    expect(warn).toHaveBeenCalledTimes(3);
    expect(h.notifications.filter((n) => n.method === "analytics.track")).toEqual([
      {
        method: "analytics.track",
        params: { name: "level_complete", props: { level: 3, perfect: true, note: null } },
      },
    ]);
  });

  it("caps analytics at the per-minute limit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h = setup();
    await h.client.init();
    for (let i = 0; i < 150; i++) h.client.analytics.track("tick");
    vi.advanceTimersByTime(60_001);
    h.client.analytics.track("tick");
    await flushMessages();
    expect(h.notifications.filter((n) => n.method === "analytics.track")).toHaveLength(121);
  });

  it("reports uncaught errors when captureErrors is on", async () => {
    h = setup();
    await h.client.init({ captureErrors: true });
    const event = new Event("error");
    Object.defineProperty(event, "error", { value: new Error("uncaught") });
    h.game.dispatchEvent(event);
    await flushMessages();
    expect(h.notifications).toContainEqual({
      method: "lifecycle.error",
      params: expect.objectContaining({ message: "uncaught" }),
    });
  });
});

describe("client-side checks", () => {
  beforeEach(() => {
    h = setup();
  });

  it("rejects oversized and invalid saves without a round trip", async () => {
    await h.client.init();
    const before = h.requests.length;
    expect((await rejection(h.client.storage.set("big", "x".repeat(300 * 1024)))).code).toBe(
      "payload_too_large",
    );
    expect((await rejection(h.client.storage.set("", 1))).code).toBe("bad_request");
    expect((await rejection(h.client.storage.set("k".repeat(129), 1))).code).toBe("bad_request");
    expect((await rejection(h.client.storage.set("u", undefined))).code).toBe("bad_request");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect((await rejection(h.client.storage.set("c", cyclic))).code).toBe("bad_request");
    expect((await rejection(h.client.leaderboards.submit("daily", Number.NaN))).code).toBe(
      "bad_request",
    );
    expect((await rejection(h.client.leaderboards.top("daily", { limit: 500 }))).code).toBe(
      "bad_request",
    );
    expect((await rejection(h.client.feedback.submit({ kind: "bug", body: "" }))).code).toBe(
      "bad_request",
    );
    expect(h.requests.length).toBe(before);
  });

  it("rejects later-phase features the shell doesn't offer", async () => {
    await h.client.init();
    const before = h.requests.length;
    expect((await rejection(h.client.ads.show({ type: "rewarded" }))).code).toBe(
      "feature_unavailable",
    );
    expect((await rejection(h.client.payments.catalog())).code).toBe("feature_unavailable");
    expect((await rejection(h.client.payments.purchase("gems"))).code).toBe("feature_unavailable");
    expect((await rejection(h.client.multiplayer.ticket())).code).toBe("feature_unavailable");
    expect(h.requests.length).toBe(before);
  });

  it("asks the shell for entitlements instead of checking features.payments", async () => {
    h.answer = (msg) =>
      msg.method === "handshake"
        ? { result: HANDSHAKE }
        : { error: { code: "feature_unavailable", message: "Not offered" } };
    await h.client.init();
    expect((await rejection(h.client.payments.entitlements())).code).toBe("feature_unavailable");
    expect((await rejection(h.client.payments.consume("gems"))).code).toBe("feature_unavailable");
    expect(h.requests.map((r) => r.method).slice(-2)).toEqual([
      "payments.entitlements",
      "payments.consume",
    ]);
  });

  it("forwards later-phase calls once the shell offers them", async () => {
    h.client.destroy();
    h = setup({
      answer: (msg) =>
        msg.method === "handshake"
          ? {
              result: {
                ...HANDSHAKE,
                features: { multiplayer: false, ads: true, payments: false },
              },
            }
          : { result: { shown: true, rewarded: true } },
    });
    await expect(h.client.ads.show({ type: "rewarded", placement: "level_end" })).resolves.toEqual({
      shown: true,
      rewarded: true,
    });
  });

  it("sends JSON-normalized save values", async () => {
    h.answer = (msg) =>
      msg.method === "handshake" ? { result: HANDSHAKE } : { result: { version: 1 } };
    await h.client.storage.set("progress", { at: new Date(0), skip: undefined, level: 4 });
    expect(h.requests.at(-1)?.params).toEqual({
      key: "progress",
      value: { at: "1970-01-01T00:00:00.000Z", level: 4 },
    });
  });
});

describe("destroy", () => {
  it("rejects pending calls and stops listening", async () => {
    h = setup();
    await h.client.init();
    const pending = rejection(h.client.storage.list());
    await flushMessages();
    h.client.destroy();
    expect((await pending).code).toBe("not_in_shell");
    expect((await rejection(h.client.storage.list())).code).toBe("not_in_shell");
  });
});
