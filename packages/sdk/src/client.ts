import type {
  BridgeMethod,
  BridgeNotification,
  BridgeParams,
  BridgeResult,
} from "@infinitegamer/protocol/bridge";
import { IgError, type ErrorCode } from "@infinitegamer/protocol/errors";
import { SDK_LIMITS } from "@infinitegamer/protocol/limits";
import { isLocale, negotiateLocale, type Locale } from "@infinitegamer/protocol/locales";
import { AudioController, type AudioModule } from "./audio.ts";
import { readLaunchParams, type LaunchParams } from "./launch.ts";
import type { MockBackend, MockControls } from "./mock.ts";
import {
  BRIDGE_TIMEOUT_MS,
  BRIDGE_VERSION,
  TRUSTED_SHELL_ORIGINS,
  isLoopbackOrigin,
} from "./protocol.ts";
import type { RoomDeps } from "./room.ts";
import type { StageDeps } from "./stage.ts";
import { BridgeTransport, type Backend } from "./transport.ts";
import type {
  Achievement,
  AdRequest,
  AdResult,
  AnalyticsProps,
  AroundOptions,
  ClientOptions,
  Clip,
  ClipRecordOptions,
  ClipRecording,
  ClipShareOptions,
  CreateMatchOptions,
  Entitlement,
  FeedbackKind,
  FeedbackSubmission,
  Features,
  Friend,
  IdentityToken,
  IgContext,
  IgEventName,
  IgEvents,
  InitOptions,
  Invite,
  LeaderboardEntry,
  Match,
  MatchmakeOptions,
  MockOptions,
  MultiplayerTicket,
  Player,
  Product,
  PurchaseResult,
  QuickMatchOptions,
  RemoteConfig,
  Room,
  SaveEntry,
  SaveKeyInfo,
  SaveOptions,
  ShowLeaderboardOptions,
  SignInResult,
  Stage,
  StageWatchOptions,
  SubmitScoreResult,
  TicketRequest,
  TopOptions,
  TurnSubmission,
  UnlockResult,
} from "./types.ts";
import { analyticsProblem, checkId, checkInt, checkSaveKey, toJsonValue } from "./validate.ts";
import { SDK_VERSION } from "./version.ts";

/** The current player and their identity token. */
export interface PlayerModule {
  /** Fetches the current player from the shell. */
  get(): Promise<Player>;
  /**
   * A signed token (JWT) that proves who the player is to your own server. Verify it against
   * `https://infinitegamer.net/.well-known/jwks.json`; its `sub` is the studio-scoped {@link Player.id}.
   * Cached until a minute before it expires. In mock mode the token is unsigned (`alg: none`) and
   * your server must reject it.
   */
  identityToken(): Promise<IdentityToken>;
  /**
   * Asks the player to sign in to their Infinite Gamer account (or create one), with Google, Apple, Microsoft,
   * Discord, Twitch, Facebook, GitHub, or an email link. The platform shows the sign-in, so your game never sees
   * how the player signs in. Waits until it closes. A `player.change` event follows a successful sign-in.
   *
   * @example
   * ```ts
   * const { signedIn } = await IG.player.signIn();
   * if (signedIn) showCloudSaveBadge();
   * ```
   */
  signIn(): Promise<SignInResult>;
  /**
   * Signs the player out of your game on this device, for games on your own site (connected mode). They're a guest
   * until they sign in again, and a `player.change` event follows. Inside Infinite Gamer players sign out on the
   * platform, so this rejects with `feature_unavailable` there and in mock mode.
   */
  signOut(): Promise<void>;
}

/**
 * Cloud saves: JSON values per player per game, stored by Infinite Gamer. Use them as the source of truth,
 * because browsers partition and expire storage inside iframes. Values are limited to 256 KB of JSON each,
 * 200 keys and 5 MB per player per game.
 */
export interface StorageModule {
  /** Reads a value, or `null` when the key doesn't exist. */
  get<T = unknown>(key: string): Promise<T | null>;
  /** Reads a value with its version, for use with {@link SaveOptions.ifVersion}. */
  getEntry<T = unknown>(key: string): Promise<SaveEntry<T>>;
  /**
   * Writes a value. It goes through `JSON.stringify`, so `Date`s become strings and `undefined` properties
   * are dropped. Rejects with `payload_too_large` over 256 KB, `quota_exceeded` over the per-game quota, and
   * `conflict` when {@link SaveOptions.ifVersion} doesn't match.
   *
   * @returns The new version.
   */
  set(key: string, value: unknown, options?: SaveOptions): Promise<{ version: number }>;
  /** Deletes a key. Deleting a key that doesn't exist is fine. */
  delete(key: string): Promise<void>;
  /** Lists the player's keys for this game. */
  list(): Promise<SaveKeyInfo[]>;
}

/** Leaderboards declared in the game's `infinitegamer.json`. */
export interface LeaderboardsModule {
  /**
   * Submits a score. The leaderboard keeps each player's best (highest, or lowest for `sort: "asc"`).
   *
   * @param leaderboard The leaderboard id from `infinitegamer.json`.
   * @param metadata Optional details kept with the score, e.g. `{ level: 4 }`.
   */
  submit(
    leaderboard: string,
    score: number,
    metadata?: Record<string, unknown>,
  ): Promise<SubmitScoreResult>;
  /** The top rows of a leaderboard. */
  top(leaderboard: string, options?: TopOptions): Promise<LeaderboardEntry[]>;
  /** The rows around the current player. Empty when the player has no score yet. */
  around(leaderboard: string, options?: AroundOptions): Promise<LeaderboardEntry[]>;
  /**
   * Opens the platform's leaderboards screen for your game, on one board if you name it. Waits until it closes;
   * the game is paused meanwhile.
   */
  show(leaderboard?: string, options?: ShowLeaderboardOptions): Promise<void>;
}

/** Achievements declared in the game's `infinitegamer.json`. */
export interface AchievementsModule {
  /**
   * Unlocks an achievement for the player. The platform shows a banner the first time, unless `infinitegamer.json`
   * sets `game.achievementBanners` to `false`. Safe to call repeatedly.
   */
  unlock(achievement: string): Promise<UnlockResult>;
  /** Every achievement declared for the game, with the player's unlock times. */
  list(): Promise<Achievement[]>;
  /** Opens the platform's achievements screen for your game. Waits until it closes; the game is paused meanwhile. */
  show(): Promise<void>;
}

/** Custom analytics events, shown in the developer portal next to the built-in play metrics. */
export interface AnalyticsModule {
  /**
   * Records an event. Fire and forget: invalid events and events over the rate limit (120 a minute) are
   * dropped with a console warning instead of throwing.
   *
   * @param name snake_case, starting with a letter, at most 64 characters, e.g. `level_complete`.
   * @param props Flat properties with string, number, boolean, or null values, at most 4 KB of JSON.
   */
  track(name: string, props?: AnalyticsProps): void;
}

/** Player feedback that goes to the developer portal. */
export interface FeedbackModule {
  /**
   * Opens the shell's feedback dialog (a rating and review by default). Waits for the player to close it.
   *
   * @returns Whether the player sent something.
   */
  open(options?: { kind?: FeedbackKind }): Promise<{ submitted: boolean }>;
  /** Sends feedback without a dialog, e.g. from your own in-game bug report form. */
  submit(feedback: FeedbackSubmission): Promise<{ id: string }>;
}

/**
 * Ads, shown by the shell between your game's moments. Rejects with `feature_unavailable` unless the
 * game turns ads on in the developer portal. In mock mode every ad "plays" instantly.
 */
export interface AdsModule {
  /**
   * Shows an interstitial or rewarded ad and waits until it closes. Frequency caps, Premium (no ads,
   * rewards without watching), and age rules are applied for you, so `shown` is often `false`.
   */
  show(request: AdRequest): Promise<AdResult>;
}

/**
 * In-app purchases with IG Coins. Rejects with `feature_unavailable` unless the game sells items.
 * In mock mode products come from `init({ mock: { products } })` and purchases are free.
 */
export interface PaymentsModule {
  /** Products set up for this game in the developer portal. */
  catalog(): Promise<Product[]>;
  /** Asks the player to buy a product in the shell's purchase sheet. Waits for the sheet to close. */
  purchase(product: string): Promise<PurchaseResult>;
  /** Products the player owns, including unconsumed consumables. */
  entitlements(): Promise<Entitlement[]>;
  /** Uses up owned consumables (default 1). Rejects with `conflict` when the player has fewer. */
  consume(product: string, quantity?: number): Promise<{ remaining: number }>;
}

/**
 * Realtime rooms. The room client loads on first use, so games that don't use multiplayer don't pay for it.
 * In mock mode you get a room of your own, so solo testing works without the shell.
 */
export interface MultiplayerModule {
  /**
   * Joins a room by code, creates one, or quick-joins a public room of the mode. Rejects with `not_found`
   * for an unknown code and `conflict` when the room is full or locked.
   */
  join(request?: TicketRequest): Promise<Room>;
  /** Waits for other players with the same mode (and region and similar skill), then joins the room they share. */
  matchmake(options: MatchmakeOptions): Promise<Room>;
  /** A single-use, 60-second ticket for connecting to a room with your own WebSocket code. */
  ticket(request?: TicketRequest): Promise<MultiplayerTicket>;
  /**
   * The invite the game was opened with (or the latest one since), or `null`. Clears it, so call it once at
   * startup and listen for the `invite` event for invites that arrive while the game runs.
   */
  takeInvite(): Promise<Invite | null>;
}

/** Turn-based matches: players take turns at their own pace, and are notified when it's their turn. */
export interface MatchesModule {
  /** Creates a match and invites players. You take the first turn. */
  create(options?: CreateMatchOptions): Promise<Match>;
  /** Joins the oldest open match of the mode and size that hasn't started, or creates an open one. */
  quick(options?: QuickMatchOptions): Promise<Match>;
  /** Joins a match you were invited to or that is open. */
  join(matchId: string): Promise<Match>;
  /** The latest state of a match you're in. */
  get(matchId: string): Promise<Match>;
  /** Your matches, newest activity first. */
  list(status?: "active" | "finished"): Promise<Match[]>;
  /** Takes your turn. Rejects with `conflict` if the match moved on since the version you read. */
  submitTurn(matchId: string, turn: TurnSubmission): Promise<Match>;
  /** Leaves a match. The match ends as a forfeit if too few players remain. */
  leave(matchId: string): Promise<Match>;
}

/** The player's friends on Infinite Gamer, as your game may see them. */
export interface FriendsModule {
  /** Friends with their presence. `playingOnly` keeps those playing this game right now. */
  list(options?: { playingOnly?: boolean }): Promise<Friend[]>;
  /** Invites a friend to a room or match. They get a notification with a link. Resolves `false` if they turned notifications off. */
  invite(playerId: string, to: { room?: string; matchId?: string }): Promise<boolean>;
  /** Sends a friend request to a player met in the game. */
  request(playerId: string): Promise<"requested" | "friends">;
}

/** Values you set in the developer portal, per environment, with optional rollouts by locale, platform, or percentage. */
export interface RemoteConfigModule {
  /** One value, or `fallback` when it isn't set. Fetched once per session; see {@link RemoteConfigModule.refresh}. */
  get<T>(key: string, fallback: T): Promise<T>;
  /** Every value, with the version and the overrides that matched. */
  getAll(): Promise<RemoteConfig>;
  /** Fetches the config again, e.g. between rounds. */
  refresh(): Promise<RemoteConfig>;
}

/** Gameplay clips: record a canvas, then hand the video to the shell's share sheet. */
export interface ClipsModule {
  /**
   * Starts recording `canvas` (and optional game audio). Loads the recorder on first use. Throws
   * `feature_unavailable` where the browser can't record (no `MediaRecorder` or `captureStream`), and in the
   * npm build until the game imports `@infinitegamer/sdk/clips`.
   *
   * @example
   * ```ts
   * const recording = await IG.clips.record({ canvas, maxSeconds: 15 });
   * // ...the player does something great...
   * const clip = await recording.stop();
   * await IG.clips.share(clip, { text: "New best!" });
   * ```
   */
  record(options: ClipRecordOptions): Promise<ClipRecording>;
  /** Opens the shell's share sheet for the clip (share, save, copy the game link). Waits for the player to close it. */
  share(clip: Clip, options?: ClipShareOptions): Promise<{ shared: boolean }>;
}

/**
 * Stage games: one player at a time, everyone else waits in line or watches the current player live. The stage
 * client loads on first use: in the CDN build it's fetched next to `ig.global.js`; in the npm build, import
 * `@infinitegamer/sdk/stage` once. In mock mode a simulated line, ready check, and turn let you test alone.
 */
export interface StageModule {
  /**
   * Starts watching the game's stage and resolves with it. Every player starts as a `viewer`; call
   * {@link Stage.join} to get in line. Calling it again resolves with the same {@link Stage}.
   *
   * @example
   * ```ts
   * const stage = await IG.stage.watch<{ x: number; y: number }>();
   * stage.on("state", ({ state }) => drawGhost(state));
   * stage.on("role", ({ role }) => (role === "player" ? startPlaying() : showViewerMode()));
   * ```
   */
  watch<S = unknown>(options?: StageWatchOptions): Promise<Stage<S>>;
}

/** Set by the entry point: the npm build imports the room client, the CDN build loads it as a script. */
export const roomRuntime: { load?: () => Promise<typeof import("./room.ts")> } = {};
/** Set by the entry point, like {@link clipsRuntime}, for the stage client (`@infinitegamer/sdk/stage` on npm). */
export const stageRuntime: { load?: () => Promise<typeof import("./stage.ts")> } = {};
/**
 * Set by the entry point, like {@link roomRuntime}, for the clip recorder: the CDN build loads it as a script,
 * and the npm build registers it when the game imports `@infinitegamer/sdk/clips`.
 */
export const clipsRuntime: { load?: () => Promise<typeof import("./clips.ts")> } = {};
/** Set by the entry point, like {@link roomRuntime}, for mock mode: only games outside the platform load it. */
export const mockRuntime: { load?: () => Promise<typeof import("./mock.ts")> } = {};
/** Set by the entry point, like {@link roomRuntime}, for connected mode: games on their own sites that pass `gameId`. */
export const connectedRuntime: { load?: () => Promise<typeof import("./connected.ts")> } = {};

const lazy = <T>(runtime: { load?: () => Promise<T> }): Promise<T> =>
  runtime.load?.() ?? Promise.reject(new IgError("feature_unavailable"));

type Call = <M extends BridgeMethod>(
  method: M,
  params: BridgeParams<M>,
) => Promise<BridgeResult<M>>;
type Listener = (data: never) => void;

function normalizeMock(mock: InitOptions["mock"]): MockOptions & { enabled: boolean | "auto" } {
  if (mock === undefined || mock === "auto") return { enabled: "auto" };
  if (typeof mock === "boolean") return { enabled: mock };
  return { ...mock, enabled: mock.enabled ?? "auto" };
}

function isPlayer(value: unknown): value is Player {
  const p = value as Player | null;
  return (
    typeof p === "object" &&
    p !== null &&
    typeof p.id === "string" &&
    typeof p.displayName === "string" &&
    isLocale(p.locale)
  );
}

function errorParts(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return {
      message: (err.message || err.name).slice(0, 1000),
      ...(err.stack ? { stack: err.stack.slice(0, 4000) } : {}),
    };
  }
  let message: string;
  try {
    message = typeof err === "string" ? err : (JSON.stringify(err) ?? String(err));
  } catch {
    message = String(err);
  }
  return { message: (message || "Unknown error").slice(0, 1000) };
}

/**
 * An SDK client. Most games use the ready-made {@link IG} instance; {@link createClient} makes more,
 * e.g. one per test.
 */
export class IgClient {
  /** The current player and their identity token. */
  readonly player: PlayerModule;
  /** Cloud saves. */
  readonly storage: StorageModule;
  /** Leaderboards. */
  readonly leaderboards: LeaderboardsModule;
  /** Achievements. */
  readonly achievements: AchievementsModule;
  /** Custom analytics events. */
  readonly analytics: AnalyticsModule;
  /** Player feedback. */
  readonly feedback: FeedbackModule;
  /** Ads. Phase 4. */
  readonly ads: AdsModule;
  /** In-app purchases. Phase 4. */
  readonly payments: PaymentsModule;
  /** Realtime rooms and matchmaking. */
  readonly multiplayer: MultiplayerModule;
  /** Turn-based matches. */
  readonly matches: MatchesModule;
  /** Friends and presence. */
  readonly friends: FriendsModule;
  /** Remote config. */
  readonly remoteConfig: RemoteConfigModule;
  /** Hands audio to the SDK so it follows the shell's pause and mute. */
  readonly audio: AudioModule;
  /** Gameplay clips. */
  readonly clips: ClipsModule;
  /** Stage games: one player at a time, everyone else watches. */
  readonly stage: StageModule;

  private readonly win: Window | undefined;
  private readonly launch: LaunchParams;
  private readonly timeoutMs: number;
  private options: InitOptions = {};
  private connecting: Promise<IgContext> | null = null;
  private backend: Backend | null = null;
  private ctx: IgContext | null = null;
  private destroyed = false;
  private state: { muted: boolean; paused: boolean };
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly queue: Array<[BridgeNotification, unknown]> = [];
  private readonly audioController: AudioController;
  private token: IdentityToken | null = null;
  private analyticsSent: number[] = [];
  private analyticsWarned = false;
  private readyAt: number | null = null;
  private inGameplay: boolean | null = null;
  private lastProgress: { pct: number; at: number } | null = null;
  private capturing = false;
  private invite: Invite | null = null;

  constructor(options: ClientOptions = {}) {
    this.win = options.window ?? (typeof window === "undefined" ? undefined : window);
    this.launch = readLaunchParams(this.win?.location?.href);
    this.timeoutMs = options.timeoutMs ?? BRIDGE_TIMEOUT_MS;
    this.state = { muted: this.launch.muted ?? false, paused: false };
    this.audioController = new AudioController(() => this.state);
    const call = this.call;

    this.player = {
      get: async () => {
        const player = await call("player.get", {});
        if (this.ctx) this.ctx.player = player;
        return player;
      },
      identityToken: async () => {
        if (this.token && Date.parse(this.token.expiresAt) - Date.now() > 60_000)
          return { ...this.token };
        const token = await call("player.identityToken", {});
        this.token = token;
        return { ...token };
      },
      signIn: async () => {
        const result = await call("player.signIn", {});
        this.token = null;
        if (this.ctx) this.ctx.player = result.player;
        return result;
      },
      signOut: async () => {
        await this.connect();
        const backend = this.backend as { signOut?(): Promise<void> } | null;
        if (!backend?.signOut)
          throw new IgError("feature_unavailable", "Players sign out on Infinite Gamer");
        this.token = null;
        await backend.signOut();
      },
    };

    this.storage = {
      get: async <T>(key: string) => (await this.storage.getEntry<T>(key)).value,
      getEntry: async <T>(key: string): Promise<SaveEntry<T>> => {
        checkSaveKey(key);
        const result = await call("storage.get", { key });
        return { value: (result.value ?? null) as T | null, version: result.version };
      },
      set: async (key, value, options = {}) => {
        checkSaveKey(key);
        const { json } = toJsonValue(value);
        checkInt("ifVersion", options.ifVersion, 0, Number.MAX_SAFE_INTEGER);
        const params =
          options.ifVersion === undefined
            ? { key, value: json }
            : { key, value: json, ifVersion: options.ifVersion };
        return call("storage.set", params);
      },
      delete: async (key) => {
        checkSaveKey(key);
        await call("storage.delete", { key });
      },
      list: async () => (await call("storage.list", {})).keys,
    };

    this.leaderboards = {
      submit: async (leaderboard, score, metadata) => {
        checkId("leaderboard", leaderboard);
        if (typeof score !== "number" || !Number.isFinite(score))
          throw new IgError("bad_request", "Scores must be finite numbers");
        if (metadata === undefined) return call("leaderboards.submit", { leaderboard, score });
        return call("leaderboards.submit", {
          leaderboard,
          score,
          metadata: toJsonValue(metadata).json as Record<string, unknown>,
        });
      },
      top: async (leaderboard, options = {}) => {
        checkId("leaderboard", leaderboard);
        checkInt("limit", options.limit, 1, 100);
        if (
          options.period !== undefined &&
          options.period !== "current" &&
          options.period !== "all"
        ) {
          throw new IgError("bad_request", 'period must be "current" or "all"');
        }
        return (
          await call("leaderboards.top", {
            leaderboard,
            limit: options.limit,
            period: options.period,
          })
        ).entries;
      },
      around: async (leaderboard, options = {}) => {
        checkId("leaderboard", leaderboard);
        checkInt("range", options.range, 1, 25);
        return (await call("leaderboards.around", { leaderboard, range: options.range })).entries;
      },
      show: async (leaderboard, options = {}) => {
        if (leaderboard !== undefined) checkId("leaderboard", leaderboard);
        await call("leaderboards.show", { leaderboard, period: options.period });
      },
    };

    this.achievements = {
      unlock: async (achievement) => {
        checkId("achievement", achievement);
        return call("achievements.unlock", { achievement });
      },
      list: async () => (await call("achievements.list", {})).achievements,
      show: async () => void (await call("achievements.show", {})),
    };

    this.analytics = { track: (name, props) => this.track(name, props) };

    this.feedback = {
      open: async (options = {}) => {
        const kind = options.kind;
        if (kind !== undefined && kind !== "review" && kind !== "bug" && kind !== "suggestion") {
          throw new IgError("bad_request", 'kind must be "review", "bug", or "suggestion"');
        }
        return call("feedback.open", { kind });
      },
      submit: async ({ kind, body, context }) => {
        if (kind !== "bug" && kind !== "suggestion")
          throw new IgError("bad_request", 'kind must be "bug" or "suggestion"');
        if (
          typeof body !== "string" ||
          body.trim().length === 0 ||
          body.length > SDK_LIMITS.feedbackBodyMax
        ) {
          throw new IgError(
            "bad_request",
            `Feedback is 1 to ${SDK_LIMITS.feedbackBodyMax} characters`,
          );
        }
        if (context === undefined) return call("feedback.submit", { kind, body });
        return call("feedback.submit", {
          kind,
          body,
          context: toJsonValue(context).json as Record<string, unknown>,
        });
      },
    };

    this.ads = {
      show: async (request) => {
        await this.requireFeature("ads", "Ads");
        return call("ads.show", { type: request.type, placement: request.placement });
      },
    };

    this.payments = {
      catalog: async () => {
        await this.requireFeature("payments", "Payments");
        return (await call("payments.catalog", {})).products;
      },
      purchase: async (product) => {
        await this.requireFeature("payments", "Payments");
        checkId("product", product);
        return call("payments.purchase", { product });
      },
      entitlements: async () => {
        await this.requireFeature("payments", "Payments");
        return (await call("payments.entitlements", {})).entitlements;
      },
      consume: async (product, quantity = 1) => {
        await this.requireFeature("payments", "Payments");
        checkId("product", product);
        return call("payments.consume", { product, quantity });
      },
    };

    const ticket = async ({ mode, room, create }: TicketRequest = {}) => {
      await this.requireFeature("multiplayer", "Multiplayer");
      return call("multiplayer.ticket", { mode, room, create });
    };
    const rooms = () => lazy(roomRuntime);
    const deps: RoomDeps & StageDeps = {
      call,
      join: (request) => this.multiplayer.join(request),
      error: (code, message, details) => new IgError(code as ErrorCode, message, details),
      WebSocket: (this.win as { WebSocket?: RoomDeps["WebSocket"] } | undefined)?.WebSocket,
      ig: this,
      send: (method, params) => this.send(method, params),
    };
    this.multiplayer = {
      ticket,
      takeInvite: async () => {
        await this.connect();
        const invite = this.invite;
        this.invite = null;
        return invite;
      },
      join: async (request) => {
        const [t, runtime] = await Promise.all([ticket(request), rooms()]);
        return runtime.connect(t, deps);
      },
      matchmake: async (options) => {
        const [runtime] = await Promise.all([
          rooms(),
          this.requireFeature("multiplayer", "Multiplayer"),
        ]);
        return runtime.matchmake(options, deps);
      },
    };

    const match = async <M extends BridgeMethod>(method: M, params: BridgeParams<M>) => {
      await this.requireFeature("multiplayer", "Multiplayer");
      return call(method, params);
    };
    this.matches = {
      create: async (options = {}) => (await match("matches.create", options)).match,
      quick: async (options = {}) => (await match("matches.quick", options)).match,
      join: async (matchId) => (await match("matches.join", { matchId })).match,
      get: async (matchId) => (await match("matches.get", { matchId })).match,
      list: async (status = "active") => (await match("matches.list", { status })).matches,
      submitTurn: async (matchId, turn) =>
        (await match("matches.submitTurn", { ...turn, matchId })).match,
      leave: async (matchId) => (await match("matches.leave", { matchId })).match,
    };

    this.friends = {
      list: async ({ playingOnly = false } = {}) =>
        (await call("friends.list", { playingOnly })).friends,
      invite: async (playerId, to) =>
        (await call("friends.invite", { playerId, room: to.room, matchId: to.matchId })).sent,
      request: async (playerId) => (await call("friends.request", { playerId })).status,
    };

    let config: Promise<RemoteConfig> | null = null;
    const refresh = () => {
      config = call("remoteConfig.get", {});
      config.catch(() => (config = null));
      return config;
    };
    this.remoteConfig = {
      getAll: () => config ?? refresh(),
      refresh,
      get: async (key, fallback) => {
        const { values } = await (config ?? refresh());
        return Object.prototype.hasOwnProperty.call(values, key)
          ? (values[key] as typeof fallback)
          : fallback;
      },
    };

    this.audio = {
      register: (target) => {
        this.connectQuietly();
        return this.audioController.register(target);
      },
    };

    this.clips = {
      record: async (options) => (await lazy(clipsRuntime)).record(options, deps),
      share: async (clip, options) =>
        call("clips.share", { ...options, clip: clip.blob, durationMs: clip.durationMs }),
    };

    this.stage = { watch: async (options) => (await lazy(stageRuntime)).watch(options, deps) };
  }

  /**
   * Connects to the shell: a handshake that agrees on the bridge version and returns the player, locale,
   * and sound state. Outside the shell (opened directly, or from your dev server) it switches to mock mode
   * instead, or, with `gameId`, to connected mode for games on your own site. Calling it is optional: any other
   * call connects on first use. Pass options on the first call; later calls return the same promise.
   *
   * @example
   * ```ts
   * import { IG } from "@infinitegamer/sdk";
   *
   * const { player, locale, muted } = await IG.init();
   * ```
   */
  init(options: InitOptions = {}): Promise<IgContext> {
    if (this.connecting) {
      if (Object.keys(options).length > 0)
        console.warn(
          "[IG] init() options are ignored after the SDK has connected; call init() first.",
        );
      return this.connecting;
    }
    this.options = options;
    if (options.captureErrors) this.captureErrors();
    return this.connect();
  }

  /** Context from the handshake, or `null` before {@link IgClient.init} resolves. Kept up to date by shell events. */
  get context(): IgContext | null {
    return this.ctx;
  }

  /**
   * `true` when the SDK fakes the platform locally (see the mock mode guide). Settled once
   * {@link IgClient.init} resolves; before that it's a best guess from the iframe URL.
   */
  get isMock(): boolean {
    if (this.backend) return this.backend.isMock;
    const mock = normalizeMock(this.options.mock).enabled;
    return mock === true || (mock === "auto" && !this.options.gameId && this.findShell(false) === null);
  }

  /** The player's locale. Available right away from the iframe URL, then from the handshake and `locale.change` events. */
  get locale(): Locale {
    return (
      this.ctx?.locale ??
      this.launch.locale ??
      negotiateLocale(this.win?.navigator?.languages ?? [])
    );
  }

  /** Whether the game should be silent right now. Games in the feed start muted until the first tap. */
  get muted(): boolean {
    return this.state.muted;
  }

  /** Whether the shell has paused the game. */
  get paused(): boolean {
    return this.state.paused;
  }

  /** Mock mode controls, or `null` when the SDK is talking to the real shell (or hasn't connected yet). */
  get mock(): MockControls | null {
    return this.backend?.isMock ? (this.backend as MockBackend).controls : null;
  }

  /**
   * Reports loading progress so the shell can show a progress bar. Call it as often as you like;
   * the SDK sends at most one update per percent.
   *
   * @param progress From 0 to 1.
   */
  loadingProgress(progress: number): void {
    if (typeof progress !== "number" || Number.isNaN(progress)) return;
    const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
    const now = Date.now();
    const last = this.lastProgress;
    if (last && (pct === last.pct || (pct !== 100 && now - last.at < 100))) return;
    this.lastProgress = { pct, at: now };
    this.send("lifecycle.loadingProgress", { progress: pct / 100 });
  }

  /**
   * Tells the shell the game has loaded and can be played. Call it once, as soon as the first playable frame
   * is on screen: the time to `ready()` counts toward the instant-play budget. Games that never call it are
   * still shown.
   */
  ready(): void {
    if (this.readyAt !== null) return;
    this.readyAt = Date.now();
    const perf = this.win?.performance ?? globalThis.performance;
    const loadMs = perf ? Math.max(0, Math.round(perf.now())) : undefined;
    this.send("lifecycle.ready", loadMs === undefined ? {} : { loadMs });
  }

  /** Tells the shell active gameplay started (a level or round). Used for play-time metrics and ad timing. */
  gameplayStart(): void {
    if (this.inGameplay === true) return;
    this.inGameplay = true;
    this.send("lifecycle.gameplayStart", {});
  }

  /** Tells the shell active gameplay stopped (menu, game over, level complete). */
  gameplayStop(): void {
    if (this.inGameplay === false) return;
    this.inGameplay = false;
    this.send("lifecycle.gameplayStop", {});
  }

  /** Reports an error to the developer portal's crash metrics. Never throws. */
  error(err: unknown): void {
    this.send("lifecycle.error", errorParts(err));
  }

  /**
   * Listens for an event from the shell. Registering a listener connects the SDK if it hasn't yet.
   *
   * @returns A function that removes the listener.
   * @example
   * ```ts
   * const off = IG.on("pause", () => game.pause());
   * IG.on("resume", () => game.resume());
   * ```
   */
  on<E extends IgEventName>(event: E, handler: (data: IgEvents[E]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(handler as Listener);
    this.connectQuietly();
    return () => void set.delete(handler as Listener);
  }

  /** Disconnects: removes listeners, rejects pending calls with `not_in_shell`. Mostly for tests. */
  destroy(): void {
    this.destroyed = true;
    this.backend?.destroy();
    this.listeners.clear();
    this.queue.length = 0;
    if (this.capturing && this.win) {
      this.win.removeEventListener("error", this.onWindowError);
      this.win.removeEventListener("unhandledrejection", this.onRejection);
    }
  }

  private readonly call: Call = async <M extends BridgeMethod>(
    method: M,
    params: BridgeParams<M>,
  ) => {
    await this.connect();
    if (this.destroyed || !this.backend)
      throw new IgError("not_in_shell", "The SDK client was destroyed");
    return (await this.backend.request(method, params)) as BridgeResult<M>;
  };

  private async requireFeature(feature: keyof Features, label: string): Promise<void> {
    const ctx = await this.connect();
    if (!ctx.features[feature])
      throw new IgError("feature_unavailable", `${label} isn't available for this game yet`);
  }

  private connect(): Promise<IgContext> {
    this.connecting ??= this.handshake().then(
      (ctx) => {
        for (const [method, params] of this.queue.splice(0)) this.backend?.notify(method, params);
        return ctx;
      },
      (err: unknown) => {
        this.queue.length = 0;
        console.warn("[IG] Couldn't connect to Infinite Gamer:", err);
        throw err;
      },
    );
    return this.connecting;
  }

  private connectQuietly(): void {
    this.connect().catch(() => undefined);
  }

  private findShell(warn = true): string | null {
    const win = this.win;
    const origin = this.launch.shellOrigin;
    if (!win || !origin || win.parent === win) return null;
    const trusted =
      TRUSTED_SHELL_ORIGINS.includes(origin) ||
      isLoopbackOrigin(origin) ||
      (this.options.trustedShellOrigins ?? []).includes(origin);
    if (!trusted) {
      if (warn) console.warn(`[IG] Ignoring untrusted shell origin ${origin}.`);
      return null;
    }
    const ancestors = win.location.ancestorOrigins;
    if (ancestors && ancestors.length > 0 && ancestors[0] !== origin) {
      if (warn) console.warn(`[IG] The page embedding this game isn't ${origin}.`);
      return null;
    }
    return origin;
  }

  private async handshake(): Promise<IgContext> {
    const win = this.win;
    if (this.destroyed) throw new IgError("not_in_shell", "The SDK client was destroyed");
    if (!win) throw new IgError("not_in_shell", "The SDK runs in a browser window");
    const mock = normalizeMock(this.options.mock);
    const shellOrigin = mock.enabled === true ? null : this.findShell();
    if (!shellOrigin) {
      const gameId = this.options.gameId;
      if (gameId && mock.enabled !== true) {
        const { ConnectedBackend } = await lazy(connectedRuntime);
        const options = { gameId, platformOrigin: this.options.platformOrigin ?? TRUSTED_SHELL_ORIGINS[0]!, locale: this.locale };
        return this.useBackend(new ConnectedBackend(win, options, this.dispatch, (code, message, details) => new IgError(code as ErrorCode, message, details)));
      }
      if (mock.enabled === false) throw new IgError("not_in_shell");
      return this.useBackend(await this.mockBackend(win, mock));
    }

    const transport = new BridgeTransport(win, shellOrigin, this.dispatch, this.timeoutMs);
    let result: unknown;
    try {
      result = await transport.request(
        "handshake",
        { sdkVersion: SDK_VERSION, bridgeVersion: BRIDGE_VERSION },
        { timeoutMs: this.options.handshakeTimeoutMs ?? BRIDGE_TIMEOUT_MS, retryEveryMs: 500 },
      );
    } catch (err) {
      transport.destroy();
      if (err instanceof IgError && err.code === "bridge_timeout" && mock.enabled === "auto") {
        console.warn(
          `[IG] The shell at ${shellOrigin} didn't answer the handshake; using mock mode.`,
        );
        return this.useBackend(await this.mockBackend(win, mock));
      }
      throw err;
    }
    return this.useBackend(transport, result);
  }

  private async mockBackend(win: Window, mock: MockOptions): Promise<Backend> {
    return new (await lazy(mockRuntime)).MockBackend(win, mock, this.dispatch);
  }

  private async useBackend(backend: Backend, handshake?: unknown): Promise<IgContext> {
    const result = (handshake ??
      (await backend.request("handshake", {}))) as BridgeResult<"handshake">;
    if (this.destroyed) {
      backend.destroy();
      throw new IgError("not_in_shell", "The SDK client was destroyed");
    }
    if (typeof result !== "object" || result === null || result.bridgeVersion !== BRIDGE_VERSION) {
      backend.destroy();
      throw new IgError(
        "bridge_version_mismatch",
        `This SDK speaks bridge v${BRIDGE_VERSION}; the shell answered v${String(result?.bridgeVersion)}`,
        {
          sdk: BRIDGE_VERSION,
          shell: result?.bridgeVersion,
        },
      );
    }
    if (!isPlayer(result.player) || typeof result.gameId !== "string") {
      backend.destroy();
      throw new IgError("internal", "The shell sent an invalid handshake");
    }
    this.backend = backend;
    this.state = { muted: Boolean(result.muted), paused: Boolean(result.paused) };
    this.ctx = {
      gameId: result.gameId,
      environment: result.environment,
      player: result.player,
      locale: result.player.locale,
      muted: this.state.muted,
      paused: this.state.paused,
      features: {
        multiplayer: result.features?.multiplayer === true,
        ads: result.features?.ads === true,
        payments: result.features?.payments === true,
      },
      isMock: backend.isMock,
      sdkVersion: SDK_VERSION,
      bridgeVersion: result.bridgeVersion,
    };
    this.audioController.update();
    return this.ctx;
  }

  private readonly dispatch = (event: string, data: unknown): void => {
    const ctx = this.ctx;
    switch (event) {
      case "pause":
      case "resume":
        this.state.paused = event === "pause";
        break;
      case "mute":
      case "unmute":
        this.state.muted = event === "mute";
        break;
      case "locale.change": {
        const locale = (data as { locale?: unknown } | null)?.locale;
        if (typeof locale !== "string" || !isLocale(locale)) return;
        if (ctx) ctx.locale = locale;
        break;
      }
      case "player.change":
        if (!isPlayer(data)) return;
        this.token = null;
        if (ctx) {
          ctx.player = data;
          ctx.locale = data.locale;
        }
        break;
      case "invite":
        this.invite = data as Invite;
    }
    if (ctx) {
      ctx.muted = this.state.muted;
      ctx.paused = this.state.paused;
    }
    this.audioController.update();
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try {
        listener((data ?? {}) as never);
      } catch (err) {
        console.error(`[IG] A "${event}" listener threw`, err);
      }
    }
  };

  private send(method: BridgeNotification, params: object): void {
    if (this.destroyed) return;
    if (this.backend) {
      this.backend.notify(method, params);
      return;
    }
    if (this.queue.length < 100) this.queue.push([method, params]);
    this.connectQuietly();
  }

  private track(name: string, props: AnalyticsProps | undefined): void {
    const problem = analyticsProblem(name, props);
    if (problem) {
      console.warn(`[IG] Dropped analytics event ${JSON.stringify(name)}: ${problem}`);
      return;
    }
    const now = Date.now();
    this.analyticsSent = this.analyticsSent.filter((t) => now - t < 60_000);
    if (this.analyticsSent.length >= SDK_LIMITS.analyticsEventsPerMinute) {
      if (!this.analyticsWarned) {
        this.analyticsWarned = true;
        console.warn(
          `[IG] Analytics is limited to ${SDK_LIMITS.analyticsEventsPerMinute} events a minute; dropping events.`,
        );
      }
      return;
    }
    this.analyticsWarned = false;
    this.analyticsSent.push(now);
    this.send("analytics.track", props === undefined ? { name } : { name, props: { ...props } });
  }

  private captureErrors(): void {
    if (this.capturing || !this.win) return;
    this.capturing = true;
    this.win.addEventListener("error", this.onWindowError);
    this.win.addEventListener("unhandledrejection", this.onRejection);
  }

  private readonly onWindowError = (event: ErrorEvent): void =>
    this.error(event.error ?? event.message);
  private readonly onRejection = (event: PromiseRejectionEvent): void => this.error(event.reason);
}

/**
 * Creates a separate SDK client. Games normally use the shared {@link IG} instance; separate clients are
 * for tests (pass a fake `window`) and tools that host more than one game.
 */
export function createClient(options: ClientOptions = {}): IgClient {
  return new IgClient(options);
}
