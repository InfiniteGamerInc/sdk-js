import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IgError, createClient, type IgClient, type Player } from "../src/index.ts";

const GAME = "3f0c9a52-6f1e-4c55-9a8e-2b7d4f1e0c11";
const PLATFORM = "https://ig.test";
const API = `${PLATFORM}/api/v1/games/${GAME}`;

interface Call {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
}

let calls: Call[];
let routes: Record<string, (call: Call) => { status?: number; body?: unknown }>;
const clients: IgClient[] = [];

function jwt(claims: object): string {
  const part = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${part({ alg: "ES256" })}.${part(claims)}.sig`;
}

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function signedInRoutes() {
  routes[`POST ${PLATFORM}/api/v1/oauth/token`] = () => ({
    body: { access_token: "igp_access", token_type: "Bearer", expires_in: 900, refresh_token: "rt_next" },
  });
  routes[`POST ${API}/identity-token`] = () => ({
    body: { token: jwt({ sub: "player-1", name: "Ada", guest: false }), expiresAt: new Date(Date.now() + 3600_000).toISOString() },
  });
}

function connectedClient() {
  const c = createClient();
  clients.push(c);
  return c;
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(IgError);
    return (err as IgError).code;
  }
  throw new Error("Expected a rejection");
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  calls = [];
  routes = {};
  vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      auth: new Headers(init?.headers).get("authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const route = routes[`${call.method} ${call.url.split("?")[0]}`];
    if (!route) return json(404, { error: { code: "not_found", message: call.url } });
    const res = route(call);
    return json(res.status ?? 200, res.body ?? {});
  });
});

afterEach(() => {
  for (const c of clients.splice(0)) c.destroy();
  vi.restoreAllMocks();
});

describe("connected mode", () => {
  it("starts as a local guest outside the shell when init() gets a gameId", async () => {
    const ctx = await connectedClient().init({ gameId: GAME, platformOrigin: PLATFORM });
    expect(ctx).toMatchObject({ gameId: GAME, environment: "production", isMock: false, features: { multiplayer: true, ads: false, payments: false } });
    expect(ctx.player).toMatchObject({ isGuest: true, displayName: "Guest" });
    expect(calls).toEqual([]);
  });

  it("keeps guest saves in this browser and rejects account-only calls", async () => {
    const c = connectedClient();
    await c.init({ gameId: GAME, platformOrigin: PLATFORM });
    await c.storage.set("progress", { level: 2 });
    expect(await c.storage.getEntry("progress")).toEqual({ value: { level: 2 }, version: 1 });
    expect(await code(c.storage.set("progress", 3, { ifVersion: 0 }))).toBe("conflict");
    expect((await c.storage.list()).map((k) => k.key)).toEqual(["progress"]);
    expect(await code(c.leaderboards.submit("daily", 10))).toBe("unauthenticated");
    expect(await code(c.player.identityToken())).toBe("unauthenticated");
    expect(await c.leaderboards.around("daily")).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("reads public data without a token", async () => {
    routes[`GET ${API}/leaderboards/daily/top`] = () => ({ body: { entries: [] } });
    const c = connectedClient();
    await c.init({ gameId: GAME, platformOrigin: PLATFORM });
    await c.leaderboards.top("daily", { limit: 5 });
    expect(calls[0]).toMatchObject({ url: `${API}/leaderboards/daily/top?limit=5`, auth: null });
  });

  it("signs back in from a stored refresh token and calls the api with the player token", async () => {
    signedInRoutes();
    routes[`PUT ${API}/saves/progress`] = () => ({ body: { version: 4 } });
    window.localStorage.setItem(`ig:${GAME}:refresh`, "rt_stored");
    const c = connectedClient();
    const ctx = await c.init({ gameId: GAME, platformOrigin: PLATFORM });
    expect(ctx.player).toMatchObject({ id: "player-1", displayName: "Ada", isGuest: false });
    expect(calls[0]!.body).toEqual({ client_id: GAME, grant_type: "refresh_token", refresh_token: "rt_stored" });
    expect(window.localStorage.getItem(`ig:${GAME}:refresh`)).toBe("rt_next");
    expect(await c.storage.set("progress", { level: 3 })).toEqual({ version: 4 });
    expect(calls.at(-1)).toMatchObject({ method: "PUT", auth: "Bearer igp_access", body: { value: { level: 3 } } });
  });

  it("goes back to a guest when the refresh token is no longer valid", async () => {
    routes[`POST ${PLATFORM}/api/v1/oauth/token`] = () => ({ status: 400, body: { error: { code: "bad_request", message: "Invalid refresh token" } } });
    window.localStorage.setItem(`ig:${GAME}:refresh`, "rt_revoked");
    const ctx = await connectedClient().init({ gameId: GAME, platformOrigin: PLATFORM });
    expect(ctx.player.isGuest).toBe(true);
    expect(window.localStorage.getItem(`ig:${GAME}:refresh`)).toBeNull();
  });

  it("signs in through the connect popup with PKCE and moves guest saves to the cloud", async () => {
    signedInRoutes();
    routes[`PUT ${API}/saves/progress`] = () => ({ body: { version: 1 } });
    const popup = { closed: false, location: { href: "" } };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const c = connectedClient();
    await c.init({ gameId: GAME, platformOrigin: PLATFORM });
    await c.storage.set("progress", { level: 5 });
    const changes: Player[] = [];
    c.on("player.change", (p) => changes.push(p));

    const result = c.player.signIn();
    await vi.waitFor(() => expect(popup.location.href).toContain("/connect?"));
    const url = new URL(popup.location.href);
    expect(url.origin).toBe(PLATFORM);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: GAME,
      origin: window.location.origin,
      code_challenge_method: "S256",
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: PLATFORM,
        source: popup as unknown as Window,
        data: { type: "ig:connect", state: url.searchParams.get("state"), code: "code-1" },
      }),
    );
    expect(await result).toMatchObject({ signedIn: true, player: { id: "player-1", isGuest: false } });

    const exchange = calls.find((x) => (x.body as { grant_type?: string })?.grant_type === "authorization_code")!;
    const verifier = (exchange.body as { code_verifier: string }).code_verifier;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(url.searchParams.get("code_challenge")).toBe(challenge);
    expect(calls.find((x) => x.method === "PUT")).toMatchObject({ body: { value: { level: 5 }, ifVersion: 0 }, auth: "Bearer igp_access" });
    expect(window.localStorage.getItem(`ig:${GAME}:save:progress`)).toBeNull();
    expect(changes.map((p) => p.id)).toEqual(["player-1"]);
  });

  it("ignores connect messages from other origins or with the wrong state", async () => {
    const popup = { closed: false, location: { href: "" } };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const c = connectedClient();
    await c.init({ gameId: GAME, platformOrigin: PLATFORM });
    const result = c.player.signIn();
    await vi.waitFor(() => expect(popup.location.href).toContain("/connect?"));
    const state = new URL(popup.location.href).searchParams.get("state");
    const source = popup as unknown as Window;
    window.dispatchEvent(new MessageEvent("message", { origin: "https://evil.test", source, data: { type: "ig:connect", state, code: "x" } }));
    window.dispatchEvent(new MessageEvent("message", { origin: PLATFORM, source, data: { type: "ig:connect", state: "wrong", code: "x" } }));
    popup.closed = true;
    expect(await result).toMatchObject({ signedIn: false, player: { isGuest: true } });
    expect(calls).toEqual([]);
  });

  it("signs out: revokes the refresh token and becomes a guest", async () => {
    signedInRoutes();
    routes[`POST ${PLATFORM}/api/v1/oauth/revoke`] = () => ({ body: {} });
    window.localStorage.setItem(`ig:${GAME}:refresh`, "rt_stored");
    const c = connectedClient();
    await c.init({ gameId: GAME, platformOrigin: PLATFORM });
    const changes: Player[] = [];
    c.on("player.change", (p) => changes.push(p));
    await c.player.signOut();
    expect(calls.at(-1)).toMatchObject({ url: `${PLATFORM}/api/v1/oauth/revoke`, body: { client_id: GAME, token: "rt_next" } });
    expect(window.localStorage.getItem(`ig:${GAME}:refresh`)).toBeNull();
    expect(changes[0]).toMatchObject({ isGuest: true });
    expect(c.context?.player.isGuest).toBe(true);
  });

  it("rejects platform-only features", async () => {
    const c = connectedClient();
    await c.init({ gameId: GAME, platformOrigin: PLATFORM });
    expect(await code(c.payments.catalog())).toBe("feature_unavailable");
    expect(await code(c.feedback.open())).toBe("feature_unavailable");
  });

  it("uses mock mode without a gameId, where signOut isn't available", async () => {
    const c = connectedClient();
    const ctx = await c.init({ mock: { quiet: true, manifest: {} } });
    expect(ctx.isMock).toBe(true);
    expect(await code(c.player.signOut())).toBe("feature_unavailable");
  });
});
