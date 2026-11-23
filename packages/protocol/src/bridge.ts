import { z } from "zod";
import { CLIP_LIMITS, SDK_LIMITS } from "./limits.ts";
import { LOCALES } from "./locales.ts";
import {
  createMatchInput,
  gameFriend,
  match,
  matchmakingRequest,
  matchmakingStatus,
  quickMatchInput,
  resolvedRemoteConfig,
  roomTicket,
  roomTicketRequest,
  STAGE_ROLES,
  STAGE_TURN_END_REASONS,
  stagePlayer,
  stageSnapshot,
  stageStatus,
  stageTurnResult,
  submitTurnInput,
} from "./realtime.ts";

/**
 * The SDK bridge: a versioned postMessage protocol between a game iframe (on the games domain)
 * and the shell (on infinitegamer.net). Both sides import these schemas, so they can't drift.
 *
 * Wire format:
 * - request   game -> shell  `{ ig: 1, kind: "request", id, method, params }`
 * - response  shell -> game  `{ ig: 1, kind: "response", id, ok: true, result }` or `{ ..., ok: false, error }`
 * - event     shell -> game  `{ ig: 1, kind: "event", event, data }`
 * - notify    game -> shell  `{ ig: 1, kind: "notify", method, params }` (fire and forget)
 *
 * The shell checks `event.source` is its game iframe and `event.origin` matches the game's origin;
 * the SDK checks `event.origin` matches the shell origin it was handed in the handshake.
 */
export const BRIDGE_VERSION = 1 as const;
export const BRIDGE_TIMEOUT_MS = 10_000;

const saveKey = z.string().min(1).max(SDK_LIMITS.saveKeyMax);
const jsonValue: z.ZodType<unknown> = z.unknown();

const player = z.object({
  /** Player id scoped to the game's studio. Stable across the studio's games; never the account id. */
  id: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  isGuest: z.boolean(),
  locale: z.enum(LOCALES),
});
export type BridgePlayer = z.infer<typeof player>;

const leaderboardEntry = z.object({
  rank: z.number().int(),
  playerId: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  score: z.number(),
  isCurrentPlayer: z.boolean(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntry>;

const achievement = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  points: z.number(),
  hidden: z.boolean(),
  unlockedAt: z.string().nullable(),
});
export type BridgeAchievement = z.infer<typeof achievement>;

export const environment = z.enum(["production", "preview", "mock"]);

/** Request methods: params and result schemas for every call a game can make. */
export const bridgeMethods = {
  handshake: {
    params: z.object({ sdkVersion: z.string(), bridgeVersion: z.number().int() }),
    result: z.object({
      bridgeVersion: z.number().int(),
      shellOrigin: z.string(),
      gameId: z.string(),
      environment,
      player,
      muted: z.boolean(),
      paused: z.boolean(),
      features: z.object({
        multiplayer: z.boolean(),
        ads: z.boolean(),
        payments: z.boolean(),
      }),
    }),
  },
  "player.get": { params: z.object({}), result: player },
  "player.identityToken": {
    params: z.object({}),
    result: z.object({ token: z.string(), expiresAt: z.string() }),
  },
  /**
   * Asks the player to sign in to (or create) their Infinite Gamer account, in the platform's own sheet. Resolves
   * when it closes, with the player as they are now; `signedIn` is false if they closed it as a guest.
   */
  "player.signIn": { params: z.object({}), result: z.object({ signedIn: z.boolean(), player }) },
  "storage.get": {
    params: z.object({ key: saveKey }),
    result: z.object({ value: jsonValue.nullable(), version: z.number().int() }),
  },
  "storage.set": {
    params: z.object({
      key: saveKey,
      value: jsonValue,
      /** Optimistic concurrency: fails with `conflict` if the stored version differs. */
      ifVersion: z.number().int().optional(),
    }),
    result: z.object({ version: z.number().int() }),
  },
  "storage.delete": { params: z.object({ key: saveKey }), result: z.object({}) },
  "storage.list": {
    params: z.object({}),
    result: z.object({ keys: z.array(z.object({ key: z.string(), version: z.number().int(), updatedAt: z.string() })) }),
  },
  "leaderboards.submit": {
    params: z.object({ leaderboard: z.string(), score: z.number().finite(), metadata: z.record(z.string(), z.unknown()).optional() }),
    result: z.object({ best: z.number(), rank: z.number().int().nullable(), improved: z.boolean() }),
  },
  "leaderboards.top": {
    params: z.object({ leaderboard: z.string(), limit: z.number().int().min(1).max(100).default(10), period: z.enum(["current", "all"]).default("current") }),
    result: z.object({ entries: z.array(leaderboardEntry) }),
  },
  "leaderboards.around": {
    params: z.object({ leaderboard: z.string(), range: z.number().int().min(1).max(25).default(5) }),
    result: z.object({ entries: z.array(leaderboardEntry) }),
  },
  "achievements.unlock": {
    params: z.object({ achievement: z.string() }),
    result: z.object({ unlocked: z.boolean(), alreadyUnlocked: z.boolean() }),
  },
  "achievements.list": { params: z.object({}), result: z.object({ achievements: z.array(achievement) }) },
  /** Opens the platform's leaderboards screen for the game, on one board and period if given. Resolves when it closes. */
  "leaderboards.show": {
    params: z.object({ leaderboard: z.string().max(64).optional(), period: z.enum(["current", "all"]).optional() }),
    result: z.object({}),
  },
  /** Opens the platform's achievements screen for the game. Resolves when it closes. */
  "achievements.show": { params: z.object({}), result: z.object({}) },
  "feedback.open": {
    params: z.object({ kind: z.enum(["review", "bug", "suggestion"]).default("review") }),
    result: z.object({ submitted: z.boolean() }),
  },
  "feedback.submit": {
    params: z.object({
      kind: z.enum(["bug", "suggestion"]),
      body: z.string().min(1).max(SDK_LIMITS.feedbackBodyMax),
      context: z.record(z.string(), z.unknown()).optional(),
    }),
    result: z.object({ id: z.string() }),
  },
  /** Phase 2: a single-use ticket for `wss://infinitegamer.net/rt` (join by `room` code, `create`, or quick-join by `mode`). */
  "multiplayer.ticket": {
    params: roomTicketRequest,
    result: roomTicket,
  },
  /** Shows an interstitial or rewarded ad through the shell, after an api decision (caps, Premium, age, consent). */
  "ads.show": {
    params: z.object({ type: z.enum(["interstitial", "rewarded"]), placement: z.string().max(40).optional() }),
    result: z.object({ shown: z.boolean(), rewarded: z.boolean(), reason: z.string().optional() }),
  },
  /** The game's active products, localized for the player. */
  "payments.catalog": {
    params: z.object({}),
    result: z.object({
      products: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), priceCoins: z.number().int(), type: z.enum(["consumable", "non_consumable"]) })),
    }),
  },
  /** Opens the shell's purchase sheet and resolves when it closes. The receipt is an ES256 JWS. */
  "payments.purchase": {
    params: z.object({ product: z.string() }),
    result: z.object({ purchased: z.boolean(), receipt: z.string().nullable() }),
  },
  /** Products the player owns, with unconsumed quantities. */
  "payments.entitlements": {
    params: z.object({}),
    result: z.object({ entitlements: z.array(z.object({ product: z.string(), quantity: z.number().int(), grantedAt: z.string() })) }),
  },
  /** Uses up owned consumables (they stay in `payments.entitlements` until consumed). */
  "payments.consume": {
    params: z.object({ product: z.string().min(1).max(64), quantity: z.number().int().min(1).max(1000).default(1) }),
    result: z.object({ remaining: z.number().int() }),
  },
  /** Phase 2: joins the matchmaking queue. Poll `multiplayer.matchmakeStatus` until `matched`. */
  "multiplayer.matchmake": {
    params: matchmakingRequest,
    result: matchmakingStatus.omit({ ticket: true }),
  },
  "multiplayer.matchmakeStatus": {
    params: z.object({ requestId: z.string().max(64) }),
    result: matchmakingStatus,
  },
  "multiplayer.matchmakeCancel": {
    params: z.object({ requestId: z.string().max(64) }),
    result: z.object({}),
  },
  /** Phase 2: turn-based matches, persisted so players can take turns hours apart. */
  "matches.create": { params: createMatchInput, result: z.object({ match }) },
  "matches.quick": { params: quickMatchInput, result: z.object({ match }) },
  "matches.join": { params: z.object({ matchId: z.uuid() }), result: z.object({ match }) },
  "matches.get": { params: z.object({ matchId: z.uuid() }), result: z.object({ match }) },
  "matches.list": {
    params: z.object({ status: z.enum(["active", "finished"]).default("active") }),
    result: z.object({ matches: z.array(match) }),
  },
  "matches.submitTurn": { params: submitTurnInput.extend({ matchId: z.uuid() }), result: z.object({ match }) },
  "matches.leave": { params: z.object({ matchId: z.uuid() }), result: z.object({ match }) },
  /** Phase 2: the player's friends, with presence. */
  "friends.list": {
    params: z.object({ playingOnly: z.boolean().default(false) }),
    result: z.object({ friends: z.array(gameFriend) }),
  },
  /** Invites a friend to a room or match; they get a notification with a link. */
  "friends.invite": {
    params: z.object({ playerId: z.string().min(1).max(64), room: z.string().max(64).optional(), matchId: z.uuid().optional() }),
    result: z.object({ sent: z.boolean() }),
  },
  /** Sends a friend request to a player met in the game (studio-scoped id). */
  "friends.request": {
    params: z.object({ playerId: z.string().min(1).max(64) }),
    result: z.object({ status: z.enum(["requested", "friends"]) }),
  },
  /** Phase 2: the game's remote config for this player. */
  "remoteConfig.get": { params: z.object({}), result: resolvedRemoteConfig },
  /**
   * Phase 3: opens the shell's share sheet for a gameplay clip the game recorded (`IG.clips.record`).
   * The video travels as a `Blob` (structured clone). `shared` is true once the player shared or saved it.
   */
  "clips.share": {
    params: z.object({
      clip: z
        .custom<Blob>((v) => typeof Blob !== "undefined" && v instanceof Blob, "clip must be a Blob")
        .refine((b) => b.size > 0 && b.size <= CLIP_LIMITS.maxBytes, `Clips are 1 byte to ${CLIP_LIMITS.maxBytes} bytes`)
        .refine((b) => /^video\/(webm|mp4)\b/.test(b.type), "Clips are video/webm or video/mp4"),
      durationMs: z.number().int().min(0).max(CLIP_LIMITS.maxSeconds * 1000 + 1000),
      text: z.string().max(CLIP_LIMITS.shareTextMax).optional(),
    }),
    result: z.object({ shared: z.boolean() }),
  },
  /**
   * Stage games: the shell connects to the game's stage (one player at a time) as a viewer and returns what's on
   * it. Stage events follow until the game closes. Calling it again returns the current status.
   */
  "stage.watch": { params: z.object({}), result: stageStatus },
  /** Gets in line. Rejects with `conflict` when the line is full and `forbidden` for guests when the game requires sign-in. */
  "stage.join": { params: z.object({}), result: z.object({ role: z.enum(STAGE_ROLES), position: z.number().int().nullable() }) },
  /** Leaves the line, or gives up the turn. */
  "stage.leave": { params: z.object({}), result: z.object({}) },
  /** Answers the "you're up" check (the shell shows its own prompt too; whichever answers first counts). */
  "stage.ready": { params: z.object({ accept: z.boolean() }), result: z.object({}) },
  /** Ends the active player's turn, with an optional result viewers see as "Last turn". */
  "stage.endTurn": { params: z.object({ result: stageTurnResult.optional() }), result: z.object({}) },
} as const;

export type BridgeMethod = keyof typeof bridgeMethods;
export type BridgeParams<M extends BridgeMethod> = z.input<(typeof bridgeMethods)[M]["params"]>;
export type BridgeResult<M extends BridgeMethod> = z.output<(typeof bridgeMethods)[M]["result"]>;

/** Fire-and-forget notifications from the game. */
export const bridgeNotifications = {
  "lifecycle.ready": z.object({ loadMs: z.number().nonnegative().optional() }),
  "lifecycle.loadingProgress": z.object({ progress: z.number().min(0).max(1) }),
  "lifecycle.gameplayStart": z.object({}),
  "lifecycle.gameplayStop": z.object({}),
  "lifecycle.error": z.object({ message: z.string().max(1000), stack: z.string().max(4000).optional() }),
  "analytics.track": z.object({
    name: z.string().min(1).max(SDK_LIMITS.analyticsEventNameMax).regex(/^[a-z][a-z0-9_]*$/),
    props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  }),
  /** The active player's state for viewers (stage games). The SDK coalesces to `STAGE_LIMITS.updatesPerSecond`. */
  "stage.update": z.object({ state: jsonValue }),
} as const;
export type BridgeNotification = keyof typeof bridgeNotifications;

/** Events the shell pushes to the game. */
export const bridgeEvents = {
  pause: z.object({ reason: z.enum(["offscreen", "hidden", "ad", "overlay"]) }),
  resume: z.object({}),
  mute: z.object({}),
  unmute: z.object({}),
  "locale.change": z.object({ locale: z.enum(LOCALES) }),
  "player.change": player,
  /**
   * The player opened an invite link or notification for this game: join the room or open the match.
   * Sent right after the handshake when the game was launched from one, and any time one arrives later.
   */
  invite: z.object({ room: z.string().max(64).optional(), matchId: z.uuid().optional() }),
  /** Stage games: this player's role changed (`viewer`, `waiting`, `player`). */
  "stage.role": z.object({ role: z.enum(STAGE_ROLES), position: z.number().int().nullable() }),
  /** Stage games: this player's place in line (1 = next) and estimated wait. */
  "stage.position": z.object({ position: z.number().int(), queueLength: z.number().int(), waitSeconds: z.number().int() }),
  /** Stage games: you're up. Accept with `stage.ready` before `expiresAt` (server ms) or the turn is skipped. */
  "stage.readyCheck": z.object({ expiresAt: z.number() }),
  /** Stage games: a turn started. Times are server ms. */
  "stage.turnStart": z.object({ player: stagePlayer, turn: z.number().int(), startedAt: z.number(), endsAt: z.number() }),
  "stage.turnEnd": z.object({
    player: stagePlayer,
    turn: z.number().int(),
    reason: z.enum(STAGE_TURN_END_REASONS),
    result: stageTurnResult.nullable(),
    endedAt: z.number(),
  }),
  /** Stage games: a state update from the active player (not sent back to the player who sent it). */
  "stage.state": stageSnapshot,
  "stage.viewers": z.object({ count: z.number().int(), queueLength: z.number().int() }),
} as const;
export type BridgeEvent = keyof typeof bridgeEvents;

export const bridgeError = z.object({ code: z.string(), message: z.string() });

// A plain union: the two response variants share `kind: "response"`, which discriminatedUnion rejects.
export const bridgeEnvelope = z.union([
  z.object({ ig: z.literal(BRIDGE_VERSION), kind: z.literal("request"), id: z.string(), method: z.string(), params: z.unknown() }),
  z.object({ ig: z.literal(BRIDGE_VERSION), kind: z.literal("response"), id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({ ig: z.literal(BRIDGE_VERSION), kind: z.literal("response"), id: z.string(), ok: z.literal(false), error: bridgeError }),
  z.object({ ig: z.literal(BRIDGE_VERSION), kind: z.literal("event"), event: z.string(), data: z.unknown() }),
  z.object({ ig: z.literal(BRIDGE_VERSION), kind: z.literal("notify"), method: z.string(), params: z.unknown() }),
]);
export type BridgeEnvelope = z.infer<typeof bridgeEnvelope>;

/** SDK feature usage, detected per build and turned into listing badges. */
export const SDK_FEATURE_FOR_METHOD: Partial<Record<BridgeMethod, string>> = {
  "leaderboards.submit": "leaderboards",
  "achievements.unlock": "achievements",
  "storage.set": "cloud-saves",
  "multiplayer.ticket": "multiplayer",
  "ads.show": "contains-ads",
  "payments.purchase": "in-app-purchases",
  "multiplayer.matchmake": "multiplayer",
  "matches.create": "multiplayer",
  "matches.quick": "multiplayer",
  "stage.watch": "stage",
};

/** Params as handlers see them, after the schema fills in defaults (`limit`, `period`, `kind`, ...). */
export type BridgeParamsOutput<M extends BridgeMethod> = z.output<(typeof bridgeMethods)[M]["params"]>;
export type BridgeNotificationParams<N extends BridgeNotification> = z.output<(typeof bridgeNotifications)[N]>;
export type BridgeEventData<E extends BridgeEvent> = z.output<(typeof bridgeEvents)[E]>;

/**
 * Query parameters the shell adds to a game's iframe URL.
 * The SDK reads them once on load, from the query string or, failing that, the `#` fragment.
 * - `ig_shell`: the shell's origin, the only target the SDK posts to and accepts messages from.
 * - `ig_locale`: the player's locale, so a game can pick its language before the handshake.
 * - `ig_muted`: `1` when the game starts muted (the feed starts muted until the first tap).
 */
export const BRIDGE_URL_PARAMS = { shellOrigin: "ig_shell", locale: "ig_locale", muted: "ig_muted" } as const;

/** Methods that wait on the player (a dialog, an ad, a purchase), so neither side times them out. */
export const BRIDGE_INTERACTIVE_METHODS = [
  "feedback.open",
  "ads.show",
  "payments.purchase",
  "clips.share",
  "player.signIn",
  "leaderboards.show",
  "achievements.show",
] as const satisfies readonly BridgeMethod[];

/** Shell origins the SDK trusts in production. Loopback origins (`localhost`, `*.localhost`, `127.0.0.1`) are trusted for local development. */
export const TRUSTED_SHELL_ORIGINS = ["https://infinitegamer.net"] as const;
