import type { BridgeMethod, BridgeNotification } from "@infinitegamer/protocol/bridge";
import type { Locale } from "@infinitegamer/protocol/locales";
import { BRIDGE_VERSION } from "./protocol.ts";
import type { Backend, EventSink } from "./transport.ts";
import type { Player, SaveKeyInfo } from "./types.ts";

/*
 * Connected mode: the game runs on its own site and players sign in with Infinite Gamer. The SDK gets
 * a short-lived `igp_` player token for this game and origin through authorization code with PKCE in a popup on
 * `<platform>/connect`, and calls the api directly with it. Before sign-in the player is a local guest: saves stay
 * in this browser and calls that need an account reject with `unauthenticated`.
 *
 * The access token lives in memory only; the rotating refresh token is kept in this origin's localStorage, and
 * refreshes are serialized across tabs with a Web Lock so two tabs never spend the same one (that would end the
 * sign-in).
 */

/** Builds an error the game can `instanceof IG.IgError` (the CDN chunk has no IgError of its own). */
export type ErrorFactory = (code: string, message?: string, details?: Record<string, unknown>) => Error;

export interface ConnectedOptions {
  gameId: string;
  /** `https://infinitegamer.net`, or a local copy for testing. */
  platformOrigin: string;
  locale: Locale;
}

interface SaveRecord {
  value: unknown;
  version: number;
  updatedAt: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
}

interface Init {
  method?: string;
  body?: unknown;
  /** Guests may call it too (the api answers without a player). */
  guest?: boolean;
}

type Params = Record<string, unknown> & { key: string; leaderboard: string; matchId: string; requestId: string };
type Handler = (p: Params) => unknown;

const enc = encodeURIComponent;
const SIGN_IN_FIRST = "Sign the player in with IG.player.signIn() first";

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

function query(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== false) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

function claimsOf(token: string): { sub: string; name: string; guest?: boolean } {
  const part = token.split(".")[1] ?? "";
  const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0)))) as never;
}

/** The api for a game hosted on its own site, with the player's connected-mode token. */
export class ConnectedBackend implements Backend {
  readonly isMock = false;
  private access: { token: string; expiresAt: number } | null = null;
  private refreshing: Promise<string | null> | null = null;
  private player: Player;
  private readonly guest: Player;
  private readonly api: string;
  private readonly prefix: string;
  private readonly session = random(12);
  private events: object[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly handlers: Partial<Record<BridgeMethod, Handler>>;

  constructor(
    private readonly win: Window,
    private readonly opts: ConnectedOptions,
    private readonly emit: EventSink,
    private readonly error: ErrorFactory,
  ) {
    this.api = `${opts.platformOrigin}/api/v1/games/${enc(opts.gameId)}`;
    this.prefix = `ig:${opts.gameId}:`;
    this.guest = {
      id: this.stored("guest") ?? this.store("guest", `guest-${random(9)}`),
      displayName: "Guest",
      avatarUrl: null,
      isGuest: true,
      locale: opts.locale,
    };
    this.player = this.guest;
    this.handlers = this.createHandlers();
    win.document?.addEventListener("visibilitychange", this.onVisibility);
  }

  request(method: BridgeMethod, params: unknown): Promise<unknown> {
    const handler = this.handlers[method];
    if (!handler) return Promise.reject(this.error("feature_unavailable", `${method} is only available on Infinite Gamer`));
    return Promise.resolve().then(() => handler((params ?? {}) as Params));
  }

  notify(method: BridgeNotification, params: unknown): void {
    if (method !== "analytics.track") return;
    const { name, props } = params as { name: string; props?: object };
    this.events.push({ name, gameId: this.opts.gameId, sessionId: this.session, ts: Date.now(), props: props ?? {} });
    if (this.events.length >= 50) this.flush();
    else this.flushTimer ??= setTimeout(() => this.flush(), 5000);
  }

  destroy(): void {
    this.flush();
    this.win.document?.removeEventListener("visibilitychange", this.onVisibility);
  }

  /** Signs the player out of the game on this device: ends the refresh token's sign-in and goes back to a guest. */
  async signOut(): Promise<void> {
    const token = this.stored("refresh");
    this.unstore("refresh");
    this.signedOut();
    if (token) {
      await this.win
        .fetch(`${this.opts.platformOrigin}/api/v1/oauth/revoke`, this.post({ client_id: this.opts.gameId, token }))
        .catch(() => undefined);
    }
  }

  private readonly onVisibility = (): void => {
    if (this.win.document.visibilityState === "hidden") {
      this.flush(true);
      this.emit("pause", { reason: "hidden" });
    } else {
      this.emit("resume", {});
    }
  };

  private stored(name: string): string | null {
    try {
      return this.win.localStorage.getItem(this.prefix + name);
    } catch {
      return null;
    }
  }

  private store(name: string, value: string): string {
    try {
      this.win.localStorage.setItem(this.prefix + name, value);
    } catch {
      // Private browsing without storage: the player signs in again next visit.
    }
    return value;
  }

  private unstore(name: string): void {
    try {
      this.win.localStorage.removeItem(this.prefix + name);
    } catch {
      // Nothing stored.
    }
  }

  private post(body: unknown, headers: Record<string, string> = {}): RequestInit {
    return { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
  }

  private async failure(res: Response): Promise<Error> {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null;
    const code = body?.error?.code ?? (res.status === 401 ? "unauthenticated" : "internal");
    return this.error(code, body?.error?.message ?? res.statusText, body?.error?.details);
  }

  /** Calls the token endpoint. `null` when the grant is no longer valid (the player is signed out). */
  private async tokens(body: Record<string, string>): Promise<string | null> {
    const res = await this.win.fetch(`${this.opts.platformOrigin}/api/v1/oauth/token`, this.post({ client_id: this.opts.gameId, ...body }));
    if (res.status === 400 || res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw await this.failure(res);
    const t = (await res.json()) as TokenResponse;
    this.store("refresh", t.refresh_token);
    this.access = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
    return t.access_token;
  }

  /** A current access token, refreshing it when it's close to expiring; `null` for guests. */
  private token(force = false): Promise<string | null> {
    if (!force && this.access && this.access.expiresAt - Date.now() > 60_000) return Promise.resolve(this.access.token);
    return (this.refreshing ??= this.refresh().finally(() => (this.refreshing = null)));
  }

  private async refresh(): Promise<string | null> {
    const run = async () => {
      const refreshToken = this.stored("refresh");
      if (!refreshToken) return this.signedOut();
      const token = await this.tokens({ grant_type: "refresh_token", refresh_token: refreshToken });
      if (token) return token;
      if (this.stored("refresh") === refreshToken) this.unstore("refresh");
      return this.signedOut();
    };
    const locks = (this.win.navigator as Navigator | undefined)?.locks;
    return locks ? locks.request(`${this.prefix}refresh`, run) : run();
  }

  private signedOut(): null {
    this.access = null;
    if (!this.player.isGuest) {
      this.player = this.guest;
      this.emit("player.change", { ...this.guest });
    }
    return null;
  }

  private async call<T>(path: string, init: Init = {}): Promise<T> {
    let token = await this.token();
    if (!token && !init.guest) throw this.error("unauthenticated", SIGN_IN_FIRST);
    const send = (t: string | null) =>
      this.win.fetch(this.api + path, {
        method: init.method ?? "GET",
        headers: {
          accept: "application/json",
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          ...(t ? { authorization: `Bearer ${t}` } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    let res = await send(token);
    if (res.status === 401 && token) {
      token = await this.token(true);
      if (!token && !init.guest) throw this.error("unauthenticated", SIGN_IN_FIRST);
      res = await send(token);
    }
    if (!res.ok) throw await this.failure(res);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Fetches who the player is from a fresh identity token. */
  private async loadPlayer(): Promise<void> {
    const { token } = await this.call<{ token: string }>("/identity-token", { method: "POST", body: {} });
    const claims = claimsOf(token);
    this.player = { id: claims.sub, displayName: claims.name, avatarUrl: null, isGuest: claims.guest === true, locale: this.opts.locale };
  }

  private async handshake() {
    await this.finishRedirect();
    if (this.stored("refresh")) await this.loadPlayer().catch(() => this.signedOut());
    return {
      bridgeVersion: BRIDGE_VERSION,
      shellOrigin: this.opts.platformOrigin,
      gameId: this.opts.gameId,
      environment: "production",
      player: { ...this.player },
      muted: false,
      paused: false,
      features: { multiplayer: true, ads: false, payments: false },
    };
  }

  private connectUrl(params: Record<string, string>): string {
    return `${this.opts.platformOrigin}/connect${query({
      client_id: this.opts.gameId,
      origin: this.win.location.origin,
      code_challenge_method: "S256",
      ...params,
    })}`;
  }

  private async signIn() {
    if (!this.player.isGuest) return { signedIn: true, player: { ...this.player } };
    // Open the window first, while the tap that called signIn() still counts as a user gesture.
    const popup = this.win.open("about:blank", "ig-connect", "popup,width=480,height=720");
    const verifier = random(48);
    const state = random(16);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = b64url(new Uint8Array(digest));
    if (!popup) {
      const back = this.win.location.href.split("#")[0]!;
      this.win.sessionStorage.setItem(`${this.prefix}pkce`, JSON.stringify({ verifier, state }));
      this.win.location.assign(this.connectUrl({ code_challenge: challenge, state, mode: "redirect", redirect_uri: back }));
      return new Promise<never>(() => undefined);
    }
    popup.location.href = this.connectUrl({ code_challenge: challenge, state });
    const code = await new Promise<string | null>((resolve) => {
      let closedTimer: ReturnType<typeof setTimeout> | undefined;
      const done = (value: string | null) => {
        clearInterval(poll);
        clearTimeout(closedTimer);
        this.win.removeEventListener("message", onMessage);
        resolve(value);
      };
      const onMessage = (e: MessageEvent) => {
        const data = e.data as { type?: string; state?: string; code?: string } | null;
        if (e.origin !== this.opts.platformOrigin || e.source !== popup || data?.type !== "ig:connect" || data.state !== state) return;
        done(data.code ?? null);
      };
      // The page posts the code and then closes itself, so give a just-closed window's message time to arrive.
      const poll = setInterval(() => {
        if (popup.closed) closedTimer ??= setTimeout(() => done(null), 500);
      }, 500);
      this.win.addEventListener("message", onMessage);
    });
    if (code) await this.exchange(code, verifier);
    return { signedIn: !this.player.isGuest, player: { ...this.player } };
  }

  /** Back from a redirect sign-in (the popup was blocked): `#code=...&state=...` on this page. */
  private async finishRedirect(): Promise<void> {
    const hash = new URLSearchParams(this.win.location.hash.slice(1));
    const key = `${this.prefix}pkce`;
    let saved: string | null;
    try {
      saved = this.win.sessionStorage.getItem(key);
    } catch {
      return;
    }
    if (!saved || !hash.has("state")) return;
    const { verifier, state } = JSON.parse(saved) as { verifier: string; state: string };
    if (hash.get("state") !== state) return;
    this.win.sessionStorage.removeItem(key);
    this.win.history.replaceState(this.win.history.state, "", this.win.location.href.split("#")[0]);
    const code = hash.get("code");
    if (code) await this.exchange(code, verifier).catch((err: unknown) => console.warn("[IG] Sign-in didn't finish:", err));
  }

  private async exchange(code: string, verifier: string): Promise<void> {
    if (!(await this.tokens({ grant_type: "authorization_code", code, code_verifier: verifier }))) {
      throw this.error("unauthenticated", "Sign-in didn't finish; try again");
    }
    await this.loadPlayer();
    await this.uploadGuestSaves();
    this.emit("player.change", { ...this.player });
  }

  private localKeys(): string[] {
    const out: string[] = [];
    const storage = this.win.localStorage;
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(`${this.prefix}save:`)) out.push(k.slice(this.prefix.length + 5));
    }
    return out;
  }

  private local(key: string): SaveRecord | null {
    const raw = this.stored(`save:${key}`);
    return raw ? (JSON.parse(raw) as SaveRecord) : null;
  }

  /** Guest saves move to the player's cloud saves, unless the cloud already has that key. */
  private async uploadGuestSaves(): Promise<void> {
    for (const key of this.localKeys()) {
      const record = this.local(key);
      try {
        if (record) await this.call(`/saves/${enc(key)}`, { method: "PUT", body: { value: record.value, ifVersion: 0 } });
        this.unstore(`save:${key}`);
      } catch (err) {
        if ((err as { code?: string }).code === "conflict") this.unstore(`save:${key}`);
      }
    }
  }

  /** Sends queued analytics; `leaving` keeps the request alive while the page unloads. */
  private flush(leaving = false): void {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const events = this.events.splice(0, 100);
    if (!events.length) return;
    const token = this.access && this.access.expiresAt > Date.now() ? this.access.token : null;
    const device = this.stored("device") ?? this.store("device", crypto.randomUUID());
    void this.win
      .fetch(`${this.api}/events`, {
        ...this.post({ deviceId: device, events }, token ? { authorization: `Bearer ${token}` } : {}),
        keepalive: leaving,
      })
      .catch(() => undefined);
  }

  /** Opens the game's leaderboards and achievements page on Infinite Gamer in a new tab. */
  private show(params: Record<string, unknown>): object {
    this.win.open(`${this.opts.platformOrigin}/g/${enc(this.opts.gameId)}/leaderboards${query(params)}`, "_blank", "noopener");
    return {};
  }

  private createHandlers(): Partial<Record<BridgeMethod, Handler>> {
    const guest = () => this.player.isGuest;
    const post = (body: unknown = {}): Init => ({ method: "POST", body });
    return {
      handshake: () => this.handshake(),
      "player.get": () => ({ ...this.player }),
      "player.identityToken": () => this.call("/identity-token", post()),
      "player.signIn": () => this.signIn(),

      "storage.get": (p) => {
        if (!guest()) return this.call(`/saves/${enc(p.key)}`);
        const r = this.local(p.key);
        return { value: r?.value ?? null, version: r?.version ?? 0 };
      },
      "storage.set": (p) => {
        if (!guest()) return this.call(`/saves/${enc(p.key)}`, { method: "PUT", body: { value: p.value, ifVersion: p.ifVersion } });
        const version = this.local(p.key)?.version ?? 0;
        if (p.ifVersion !== undefined && p.ifVersion !== version) throw this.error("conflict", undefined, { currentVersion: version });
        const record: SaveRecord = { value: p.value, version: version + 1, updatedAt: new Date().toISOString() };
        this.store(`save:${p.key}`, JSON.stringify(record));
        return { version: record.version };
      },
      "storage.delete": async (p) => {
        if (!guest()) await this.call(`/saves/${enc(p.key)}`, { method: "DELETE" });
        else this.unstore(`save:${p.key}`);
        return {};
      },
      "storage.list": () => {
        if (!guest()) return this.call("/saves");
        const keys: SaveKeyInfo[] = this.localKeys().map((key) => {
          const r = this.local(key)!;
          return { key, version: r.version, updatedAt: r.updatedAt };
        });
        return { keys };
      },

      "leaderboards.submit": (p) => this.call(`/leaderboards/${enc(p.leaderboard)}/scores`, post({ score: p.score, metadata: p.metadata })),
      "leaderboards.top": (p) =>
        this.call(`/leaderboards/${enc(p.leaderboard)}/top${query({ limit: p.limit, period: p.period })}`, { guest: true }),
      "leaderboards.around": (p) =>
        guest() ? { entries: [] } : this.call(`/leaderboards/${enc(p.leaderboard)}/around${query({ range: p.range })}`),
      "leaderboards.show": (p) => this.show({ board: p.leaderboard, period: p.period }),
      "achievements.unlock": (p) => this.call(`/achievements/${enc(p.achievement as string)}/unlock`, post()),
      "achievements.list": async () => {
        const { achievements } = await this.call<{ achievements: Array<Record<string, unknown>> }>("/achievements", { guest: true });
        return {
          achievements: achievements.map(({ id, name, description, points, hidden, unlockedAt }) => ({ id, name, description, points, hidden, unlockedAt })),
        };
      },
      "achievements.show": () => this.show({ tab: "achievements" }),
      "feedback.submit": (p) => this.call("/feedback", post({ kind: p.kind, body: p.body, context: p.context })),

      "multiplayer.ticket": (p) => this.call("/multiplayer/tickets", post(p)),
      "multiplayer.matchmake": (p) => this.call("/multiplayer/matchmaking", post(p)),
      "multiplayer.matchmakeStatus": (p) => this.call(`/multiplayer/matchmaking/${enc(p.requestId)}`),
      "multiplayer.matchmakeCancel": async (p) => {
        await this.call(`/multiplayer/matchmaking/${enc(p.requestId)}`, { method: "DELETE" });
        return {};
      },

      "matches.create": (p) => this.call("/matches", post(p)),
      "matches.quick": (p) => this.call("/matches/quick", post(p)),
      "matches.join": (p) => this.call(`/matches/${enc(p.matchId)}/join`, post()),
      "matches.get": (p) => this.call(`/matches/${enc(p.matchId)}`),
      "matches.list": (p) => this.call(`/matches${query({ status: p.status })}`),
      "matches.submitTurn": ({ matchId, ...turn }) => this.call(`/matches/${enc(matchId)}/turns`, post(turn)),
      "matches.leave": (p) => this.call(`/matches/${enc(p.matchId)}/leave`, post()),

      "friends.list": (p) => this.call(`/friends${query({ playingOnly: p.playingOnly })}`),
      "friends.invite": (p) => this.call("/friends/invites", post(p)),
      "friends.request": (p) => this.call("/friends/requests", post(p)),

      "remoteConfig.get": () => this.call(`/remote-config/resolved${query({ locale: this.opts.locale })}`, { guest: true }),
    };
  }
}
