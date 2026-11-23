import type { BridgeMethod, BridgeNotification } from "@infinitegamer/protocol/bridge";
import { IgError } from "@infinitegamer/protocol/errors";
import { SDK_LIMITS } from "@infinitegamer/protocol/limits";
import { negotiateLocale } from "@infinitegamer/protocol/locales";
import { BRIDGE_VERSION } from "./protocol.ts";
import type { Backend, EventSink } from "./transport.ts";
import type {
  Achievement,
  IgEventName,
  IgEvents,
  LeaderboardEntry,
  MockManifest,
  MockOptions,
  Player,
  SaveKeyInfo,
} from "./types.ts";
import { byteLength } from "./validate.ts";

/** Controls for mock mode, available as {@link IgClient.mock} while the SDK is mocking. */
export interface MockControls {
  /** Fire a shell event at the game, e.g. `IG.mock?.emit("pause", { reason: "overlay" })` to test pause handling. */
  emit<E extends IgEventName>(event: E, data: IgEvents[E]): void;
  /** Delete every mock save, score, and achievement this game stored. */
  reset(): void;
  /** The leaderboards and achievements mock mode is using. */
  manifest(): Promise<MockManifest>;
}

const PREFIX = "ig-mock:";

interface Store {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  keys(prefix: string): string[];
}

function memoryStore(): Store {
  const map = new Map<string, string>();
  return {
    get: (key) => (map.has(key) ? (JSON.parse(map.get(key) as string) as never) : null),
    set: (key, value) => void map.set(key, JSON.stringify(value)),
    remove: (key) => void map.delete(key),
    keys: (prefix) => [...map.keys()].filter((k) => k.startsWith(prefix)),
  };
}

function localStore(storage: Storage): Store {
  return {
    get: (key) => {
      const raw = storage.getItem(PREFIX + key);
      return raw === null ? null : (JSON.parse(raw) as never);
    },
    set: (key, value) => storage.setItem(PREFIX + key, JSON.stringify(value)),
    remove: (key) => storage.removeItem(PREFIX + key),
    keys: (prefix) => {
      const out: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k?.startsWith(PREFIX + prefix)) out.push(k.slice(PREFIX.length));
      }
      return out;
    },
  };
}

function openStore(win: Window, persist: boolean): Store {
  if (!persist) return memoryStore();
  try {
    const storage = win.localStorage;
    const probe = `${PREFIX}probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return localStore(storage);
  } catch {
    return memoryStore();
  }
}

function base64url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface SaveRecord {
  value: unknown;
  version: number;
  updatedAt: string;
}

type Handler = (params: never) => unknown;

/** Fakes the whole platform in the game's own window, for local development and tests. */
export class MockBackend implements Backend {
  readonly isMock = true;
  readonly controls: MockControls;
  private readonly store: Store;
  private readonly player: Player;
  private manifestPromise: Promise<MockManifest> | null = null;
  private readonly warned = new Set<string>();
  private feedbackSeq = 0;
  private readonly handlers: Partial<Record<BridgeMethod, Handler>>;

  constructor(
    private readonly win: Window,
    private readonly options: MockOptions,
    private readonly onEvent: EventSink,
  ) {
    this.store = openStore(win, options.persist ?? true);
    this.player = {
      id: "mock-player",
      displayName: "Developer",
      avatarUrl: null,
      isGuest: false,
      locale: negotiateLocale(win.navigator?.languages ?? []),
      ...options.player,
    };
    this.controls = {
      emit: (event, data) => this.onEvent(event, data),
      reset: () => {
        for (const key of this.store.keys("")) this.store.remove(key);
      },
      manifest: () => this.manifest(),
    };
    win.document?.addEventListener("visibilitychange", this.onVisibility);
    this.handlers = this.createHandlers();
  }

  async request(method: BridgeMethod, params: unknown): Promise<unknown> {
    const handler = this.handlers[method];
    if (!handler)
      throw new IgError("feature_unavailable", `${method} isn't available in mock mode`);
    return handler(params as never);
  }

  notify(method: BridgeNotification, params: unknown): void {
    if (method === "analytics.track") {
      const { name, props } = params as { name: string; props?: unknown };
      this.log(`analytics.track ${name}`, props ?? {});
    } else {
      this.log(method, params);
    }
  }

  destroy(): void {
    this.win.document?.removeEventListener("visibilitychange", this.onVisibility);
  }

  private readonly onVisibility = (): void => {
    if (this.win.document.visibilityState === "hidden") this.onEvent("pause", { reason: "hidden" });
    else this.onEvent("resume", {});
  };

  private log(label: string, data?: unknown): void {
    if (!this.options.quiet) console.info(`[IG mock] ${label}`, data ?? "");
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[IG mock] ${message}`);
  }

  private manifest(): Promise<MockManifest> {
    if (this.options.manifest) return Promise.resolve(this.options.manifest);
    this.manifestPromise ??= this.fetchManifest();
    return this.manifestPromise;
  }

  private async fetchManifest(): Promise<MockManifest> {
    const path = this.options.manifestUrl ?? "/infinitegamer.json";
    if (path === false || typeof this.win.fetch !== "function") return {};
    try {
      const res = await this.win.fetch(new URL(path, this.win.location.href).href, {
        cache: "no-store",
      });
      if (!res.ok) return {};
      const json = (await res.json()) as MockManifest;
      return typeof json === "object" && json !== null ? json : {};
    } catch {
      return {};
    }
  }

  private async leaderboard(id: string) {
    const declared = (await this.manifest()).leaderboards ?? [];
    const def = declared.find((l) => l.id === id);
    if (!def && declared.length > 0) {
      throw new IgError("unknown_leaderboard", `No leaderboard "${id}" in infinitegamer.json`);
    }
    if (!def)
      this.warnOnce(
        `lb:${id}`,
        `Leaderboard "${id}" isn't declared in infinitegamer.json; the shell will reject it.`,
      );
    return { id, sort: def?.sort ?? "desc" };
  }

  /** A ticket for a one-player loopback room (see `room.ts`). */
  private ticket({ mode = "", room, create }: { mode?: string; room?: string; create?: object }) {
    const p = this.player;
    return {
      url: "mock:",
      ticket: JSON.stringify({ you: p.id, name: p.displayName, avatar: p.avatarUrl, mode, room, create }),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  private async achievementDefs() {
    return (await this.manifest()).achievements ?? [];
  }

  private entries(board: string): LeaderboardEntry[] {
    const best = this.store.get<{ best: number }>(`score:${board}`);
    if (!best) return [];
    return [
      {
        rank: 1,
        playerId: this.player.id,
        displayName: this.player.displayName,
        avatarUrl: this.player.avatarUrl,
        score: best.best,
        isCurrentPlayer: true,
      },
    ];
  }

  private createHandlers(): Partial<Record<BridgeMethod, Handler>> {
    const products = () => this.options.products ?? [];
    const owned = (product: string) => this.store.get<number>(`ent:${product}`) ?? 0;
    return {
      handshake: () => ({
        bridgeVersion: BRIDGE_VERSION,
        shellOrigin: this.win.location.origin,
        gameId: "mock-game",
        environment: "mock",
        player: { ...this.player },
        muted: false,
        paused: false,
        features: { multiplayer: true, ads: true, payments: true },
      }),
      "player.get": () => ({ ...this.player }),
      "player.signIn": () => {
        this.log("player.signIn: the platform shows its sign-in sheet here");
        return { signedIn: !this.player.isGuest, player: { ...this.player } };
      },
      "leaderboards.show": (params: unknown) => (this.log("leaderboards.show", params), {}),
      "achievements.show": () => (this.log("achievements.show"), {}),
      "player.identityToken": () => {
        const iat = Math.floor(Date.now() / 1000);
        const exp = iat + SDK_LIMITS.identityTokenTtlSeconds;
        const header = base64url(JSON.stringify({ alg: "none", typ: "JWT" }));
        const { id, displayName, isGuest, locale } = this.player;
        const payload = base64url(
          JSON.stringify({
            iss: "mock",
            aud: "mock-game",
            sub: id,
            iat,
            exp,
            guest: isGuest,
            locale,
            name: displayName,
          }),
        );
        return { token: `${header}.${payload}.`, expiresAt: new Date(exp * 1000).toISOString() };
      },
      "storage.get": ({ key }: { key: string }) => {
        const rec = this.store.get<SaveRecord>(`save:${key}`);
        return rec ? { value: rec.value, version: rec.version } : { value: null, version: 0 };
      },
      "storage.set": ({
        key,
        value,
        ifVersion,
      }: {
        key: string;
        value: unknown;
        ifVersion?: number;
      }) => {
        const current = this.store.get<SaveRecord>(`save:${key}`);
        const version = current?.version ?? 0;
        if (ifVersion !== undefined && ifVersion !== version) {
          throw new IgError(
            "conflict",
            `Save "${key}" is at version ${version}, not ${ifVersion}`,
            { version },
          );
        }
        const keys = this.store.keys("save:");
        if (!current && keys.length >= SDK_LIMITS.savesPerGameMaxKeys) {
          throw new IgError(
            "quota_exceeded",
            `Games can store up to ${SDK_LIMITS.savesPerGameMaxKeys} save keys per player`,
          );
        }
        let total = byteLength(JSON.stringify(value));
        for (const k of keys) {
          if (k !== `save:${key}`)
            total += byteLength(JSON.stringify(this.store.get<SaveRecord>(k)?.value ?? null));
        }
        if (total > SDK_LIMITS.savesPerGameMaxBytes) {
          throw new IgError(
            "quota_exceeded",
            `Games can store up to ${SDK_LIMITS.savesPerGameMaxBytes} bytes of saves per player`,
          );
        }
        const next: SaveRecord = {
          value,
          version: version + 1,
          updatedAt: new Date().toISOString(),
        };
        this.store.set(`save:${key}`, next);
        return { version: next.version };
      },
      "storage.delete": ({ key }: { key: string }) => {
        this.store.remove(`save:${key}`);
        return {};
      },
      "storage.list": () => {
        const keys: SaveKeyInfo[] = this.store.keys("save:").map((k) => {
          const rec = this.store.get<SaveRecord>(k) as SaveRecord;
          return { key: k.slice("save:".length), version: rec.version, updatedAt: rec.updatedAt };
        });
        return { keys: keys.sort((a, b) => a.key.localeCompare(b.key)) };
      },
      "leaderboards.submit": async ({
        leaderboard,
        score,
      }: {
        leaderboard: string;
        score: number;
      }) => {
        const { sort } = await this.leaderboard(leaderboard);
        const prev = this.store.get<{ best: number }>(`score:${leaderboard}`);
        const improved = !prev || (sort === "asc" ? score < prev.best : score > prev.best);
        const best = improved ? score : (prev as { best: number }).best;
        if (improved) this.store.set(`score:${leaderboard}`, { best });
        this.log(`leaderboards.submit ${leaderboard}`, { score, best, improved });
        return { best, rank: 1, improved };
      },
      "leaderboards.top": async ({
        leaderboard,
        limit = 10,
      }: {
        leaderboard: string;
        limit?: number;
      }) => {
        await this.leaderboard(leaderboard);
        return { entries: this.entries(leaderboard).slice(0, limit) };
      },
      "leaderboards.around": async ({ leaderboard }: { leaderboard: string }) => {
        await this.leaderboard(leaderboard);
        return { entries: this.entries(leaderboard) };
      },
      "achievements.unlock": async ({ achievement }: { achievement: string }) => {
        const defs = await this.achievementDefs();
        if (defs.length > 0 && !defs.some((a) => a.id === achievement)) {
          throw new IgError(
            "unknown_achievement",
            `No achievement "${achievement}" in infinitegamer.json`,
          );
        }
        if (defs.length === 0) {
          this.warnOnce(
            `ach:${achievement}`,
            `Achievement "${achievement}" isn't declared in infinitegamer.json; the shell will reject it.`,
          );
        }
        const already = this.store.get<string>(`ach:${achievement}`) !== null;
        if (!already) {
          this.store.set(`ach:${achievement}`, new Date().toISOString());
          this.log(`achievements.unlock ${achievement}`);
        }
        return { unlocked: true, alreadyUnlocked: already };
      },
      "achievements.list": async () => {
        const defs = await this.achievementDefs();
        const unlockedAt = (id: string) => this.store.get<string>(`ach:${id}`);
        const achievements: Achievement[] = defs.map((a) => ({
          id: a.id,
          name: a.name ?? a.id,
          description: a.description ?? "",
          points: a.points ?? 10,
          hidden: a.hidden ?? false,
          unlockedAt: unlockedAt(a.id),
        }));
        for (const key of this.store.keys("ach:")) {
          const id = key.slice("ach:".length);
          if (!defs.some((a) => a.id === id)) {
            achievements.push({
              id,
              name: id,
              description: "",
              points: 10,
              hidden: false,
              unlockedAt: unlockedAt(id),
            });
          }
        }
        return { achievements };
      },
      "feedback.open": ({ kind = "review" }: { kind?: string }) => {
        this.log(`feedback.open (${kind}): the shell shows its feedback dialog here`);
        return { submitted: false };
      },
      "feedback.submit": (params: { kind: string; body: string; context?: unknown }) => {
        this.log("feedback.submit", params);
        return { id: `mock-feedback-${++this.feedbackSeq}` };
      },
      "multiplayer.ticket": (params: { mode?: string; room?: string; create?: object }) =>
        this.ticket(params),
      "multiplayer.matchmake": ({ mode }: { mode: string }) => ({
        requestId: `mock:${mode}`,
        status: "queued",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      "multiplayer.matchmakeStatus": ({ requestId }: { requestId: string }) => {
        this.log("matchmaking: mock mode matches you into a room of your own");
        const ticket = this.ticket({ mode: requestId.slice(5) });
        return { requestId, status: "matched", expiresAt: ticket.expiresAt, ticket };
      },
      "multiplayer.matchmakeCancel": () => ({}),
      "friends.list": () => ({ friends: [] }),
      "friends.invite": (params: unknown) => (this.log("friends.invite", params), { sent: true }),
      "friends.request": (params: unknown) => (this.log("friends.request", params), { status: "requested" }),
      "remoteConfig.get": () => ({ values: { ...this.options.remoteConfig }, version: 0, overrides: [] }),
      "clips.share": () => ({ shared: false }),
      "ads.show": ({ type }: { type: string }) => {
        this.log(`ads.show (${type}): the shell plays an ad here`);
        return { shown: true, rewarded: type === "rewarded" };
      },
      "payments.catalog": () => ({ products: products() }),
      "payments.purchase": ({ product }: { product: string }) => {
        const p = products().find((x) => x.id === product);
        if (!p) throw new IgError("not_found", `No product ${product}; pass mock.products`);
        if (p.type === "consumable" || !owned(product)) this.store.set(`ent:${product}`, owned(product) + 1);
        this.log(`payments.purchase ${product}: free in mock mode`);
        return { purchased: true, receipt: `mock.${product}` };
      },
      "payments.entitlements": () => ({
        entitlements: this.store
          .keys("ent:")
          .map((k) => ({ product: k.slice(4), quantity: owned(k.slice(4)), grantedAt: "" }))
          .filter((e) => e.quantity > 0),
      }),
      "payments.consume": ({ product, quantity }: { product: string; quantity: number }) => {
        const remaining = owned(product) - quantity;
        if (remaining < 0) throw new IgError("conflict", `Not enough ${product}`);
        this.store.set(`ent:${product}`, remaining);
        return { remaining };
      },
    };
  }
}
