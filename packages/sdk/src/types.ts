import type { Locale } from "@infinitegamer/protocol/locales";

export type { Locale };

/** Where the game is running. `mock` means the SDK is faking the platform locally (see {@link IgClient.isMock}). */
export type Environment = "production" | "preview" | "mock";

/** The player, as the game sees them. */
export interface Player {
  /**
   * Player id scoped to your studio: stable across your studio's games, different for every other studio,
   * and never the player's account id or email.
   */
  id: string;
  /** Name to show in the game, e.g. on a leaderboard. */
  displayName: string;
  /** Avatar image URL, or `null` when the player has none. */
  avatarUrl: string | null;
  /** `true` for players who haven't signed in yet. Guests keep their saves when they sign in. */
  isGuest: boolean;
  /** The player's language on Infinite Gamer. */
  locale: Locale;
}

/**
 * Which optional features the shell offers this game. Ads and payments are `true` only when the game turns them on
 * and the platform has them. `payments` is about selling: on your own site (connected mode) it's `false`, but
 * `IG.payments.entitlements()` and `consume()` still work there.
 */
export interface Features {
  multiplayer: boolean;
  ads: boolean;
  payments: boolean;
}

/** What {@link IgClient.init} resolves with. */
export interface IgContext {
  /** The game's id on Infinite Gamer (`mock-game` in mock mode). */
  gameId: string;
  /** `production` for live builds, `preview` for pull request previews, `mock` for local development. */
  environment: Environment;
  /** The current player. Updated when a `player.change` event arrives. */
  player: Player;
  /** The player's locale. Updated when a `locale.change` event arrives. */
  locale: Locale;
  /** Whether the shell wants the game silent right now. Games start muted in the feed until the first tap. */
  muted: boolean;
  /** Whether the shell has paused the game (swiped away, tab hidden, overlay open). */
  paused: boolean;
  /** Later-phase features the shell offers this game. */
  features: Features;
  /** `true` when the SDK isn't talking to the shell and fakes every call locally. */
  isMock: boolean;
  /** Version of this SDK. */
  sdkVersion: string;
  /** Bridge protocol version agreed with the shell. */
  bridgeVersion: number;
}

/** What {@link PlayerModule.signIn} resolves with. */
export interface SignInResult {
  /** `true` when the player is signed in after the sheet closes (including when they already were). */
  signedIn: boolean;
  /** The player as they are now. Their saves, scores, and achievements from before signing in carry over. */
  player: Player;
}

/** Options for {@link LeaderboardsModule.show}. */
export interface ShowLeaderboardOptions {
  /** `current` for the current reset period, `all` for all time. Default `current`. */
  period?: "current" | "all";
}

/** A signed token that proves who the player is to your own server. */
export interface IdentityToken {
  /** A JWT signed by Infinite Gamer. Verify it against `https://infinitegamer.net/.well-known/jwks.json`. */
  token: string;
  /** ISO 8601 time the token expires. */
  expiresAt: string;
}

/** Any value that survives `JSON.stringify` and `JSON.parse` unchanged. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A cloud save value plus its version, for optimistic concurrency. */
export interface SaveEntry<T = unknown> {
  /** The stored value, or `null` when the key doesn't exist. */
  value: T | null;
  /** Increments on every write. `0` when the key doesn't exist. */
  version: number;
}

/** One key in the player's cloud saves for this game. */
export interface SaveKeyInfo {
  key: string;
  version: number;
  /** ISO 8601 time of the last write. */
  updatedAt: string;
}

/** Options for {@link StorageModule.set}. */
export interface SaveOptions {
  /**
   * Only write if the stored version still equals this number, otherwise reject with `conflict`.
   * Use `0` to write only if the key doesn't exist yet.
   */
  ifVersion?: number;
}

/** One row of a leaderboard. */
export interface LeaderboardEntry {
  /** 1-based rank. */
  rank: number;
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  score: number;
  /** `true` on the current player's row. */
  isCurrentPlayer: boolean;
}

/** What {@link LeaderboardsModule.submit} resolves with. */
export interface SubmitScoreResult {
  /** The player's best score on this leaderboard after the submission. */
  best: number;
  /** The player's rank after the submission, or `null` when the shell can't rank yet. */
  rank: number | null;
  /** `true` when this score beat the player's previous best. */
  improved: boolean;
}

/** Options for {@link LeaderboardsModule.top}. */
export interface TopOptions {
  /** How many rows, 1 to 100. Default 10. */
  limit?: number;
  /** `current` for the current reset period (day, week, month), `all` for all time. Default `current`. */
  period?: "current" | "all";
}

/** Options for {@link LeaderboardsModule.around}. */
export interface AroundOptions {
  /** How many rows above and below the player, 1 to 25. Default 5. */
  range?: number;
}

/** An achievement declared in the game's `infinitegamer.json`, with the player's progress. */
export interface Achievement {
  id: string;
  name: string;
  description: string;
  points: number;
  /** Hidden achievements are shown to players only once unlocked. */
  hidden: boolean;
  /** ISO 8601 time the player unlocked it, or `null`. */
  unlockedAt: string | null;
}

/** What {@link AchievementsModule.unlock} resolves with. */
export interface UnlockResult {
  /** `true` when the achievement is unlocked after the call (always, unless the shell refused). */
  unlocked: boolean;
  /** `true` when the player had already unlocked it, so no toast was shown. */
  alreadyUnlocked: boolean;
}

/** Analytics event properties: flat, with primitive values. */
export type AnalyticsProps = Record<string, string | number | boolean | null>;

/** Kinds of feedback a player can leave. */
export type FeedbackKind = "review" | "bug" | "suggestion";

/** Feedback sent from game code, without showing the feedback dialog. */
export interface FeedbackSubmission {
  kind: "bug" | "suggestion";
  /** The message, 1 to 2000 characters. */
  body: string;
  /** Extra context for you, e.g. `{ level: 4, build: "1.2.0" }`. Shown in the developer portal. */
  context?: Record<string, unknown>;
}

/** Why the shell paused the game. */
export type PauseReason = "offscreen" | "hidden" | "ad" | "overlay";

/** Events the shell sends to the game and the data each one carries. */
export interface IgEvents {
  /** Stop the game loop and sound: the card was swiped away, the tab was hidden, an ad or overlay opened. */
  pause: { reason: PauseReason };
  /** Carry on after a `pause`. */
  resume: Record<string, never>;
  /** Go silent. */
  mute: Record<string, never>;
  /** Sound may play again. */
  unmute: Record<string, never>;
  /** The player switched languages. */
  "locale.change": { locale: Locale };
  /** A different player is now playing, e.g. a guest signed in. Reload anything player-specific. */
  "player.change": Player;
  /** The player opened an invite to a room or match. Also kept for {@link MultiplayerModule.takeInvite}. */
  invite: Invite;
}

/** An invite the player opened: join `room` with {@link MultiplayerModule.join}, or open `matchId` with {@link MatchesModule.join}. */
export interface Invite {
  room?: string;
  matchId?: string;
}

/** Name of an event the shell can send. */
export type IgEventName = keyof IgEvents;

/** Interstitial or rewarded ad request. */
export interface AdRequest {
  type: "interstitial" | "rewarded";
  /** Your name for where in the game the ad shows, e.g. `level_end`. */
  placement?: string;
}

/** What {@link AdsModule.show} resolves with. */
export interface AdResult {
  /** An ad played. */
  shown: boolean;
  /** `true` when the player earned the reward (Premium players get it without watching). */
  rewarded: boolean;
  /** Why no ad played, e.g. `frequency_cap`, `premium`, `no_fill`, or `disabled`. */
  reason?: string;
}

/** An in-app purchase product, set up in the developer portal. Names are in the player's language. */
export interface Product {
  id: string;
  name: string;
  description: string;
  /** Price in IG Coins. */
  priceCoins: number;
  /** Consumables can be bought again and are used up with {@link PaymentsModule.consume}. */
  type: "consumable" | "non_consumable";
}

/** What {@link PaymentsModule.purchase} resolves with. */
export interface PurchaseResult {
  purchased: boolean;
  /** Signed receipt (ES256 JWS) to verify on your server, or `null` when nothing was bought. */
  receipt: string | null;
}

/** A product the player owns, with how many unconsumed copies. */
export interface Entitlement {
  product: string;
  quantity: number;
  grantedAt: string;
}

/** Settings for a new room. */
export interface RoomCreateOptions {
  /** Most players at once, 1 to 32. Default 8. */
  capacity?: number;
  /** `private` (default) rooms are joined by code or invite link; `public` rooms can be quick-joined. */
  visibility?: "public" | "private";
  /** Up to 2 KB of JSON anyone in the room can read, e.g. the map or rules. */
  metadata?: Record<string, unknown>;
}

/**
 * Which room to join. Pass `room` to join by code, `create` to start a new room, or neither to quick-join
 * a public room of the `mode` (a new public room is created when none has space).
 */
export interface TicketRequest {
  /** Lowercase letters, digits, `-`, and `_`. Rooms of different modes never mix. */
  mode?: string;
  /** A room code from an invite link (case-insensitive). */
  room?: string;
  create?: RoomCreateOptions;
}

/** A short-lived ticket for connecting to a realtime room. Most games call {@link MultiplayerModule.join} instead. */
export interface MultiplayerTicket {
  /** WebSocket URL; connect to `${url}?ticket=${ticket}`. */
  url: string;
  /** Single-use token, valid for 60 seconds. */
  ticket: string;
  expiresAt: string;
}

/** A player in a realtime room. */
export interface RoomPlayer {
  /** Studio-scoped player id, the same as {@link Player.id}. */
  id: string;
  displayName: string;
  avatarUrl: string | null;
  /** When the player joined, in milliseconds since the epoch. */
  joinedAt: number;
}

/** A realtime room's settings. */
export interface RoomInfo {
  /** The code other players join with. */
  code: string;
  mode: string;
  capacity: number;
  visibility: "public" | "private";
  /** Locked rooms accept no new players (players who drop can still rejoin). */
  locked: boolean;
  metadata: Record<string, unknown>;
  /** The host's player id. */
  hostId: string | null;
  /** A link that opens the game on Infinite Gamer and joins this room. */
  inviteUrl: string;
}

/** A shared state value and its version. */
export interface RoomStateEntry {
  value: unknown;
  /** Increments on every write; use it with `ifVersion` for compare-and-set. */
  version: number;
}

/** Why a player left a room. `disconnected` players lost their connection and didn't come back in time. */
export type RoomLeaveReason = "left" | "disconnected" | "kicked";

/** Events a {@link Room} emits. */
export interface RoomEvents {
  /** A relayed message from another player. */
  message: { from: string; data: unknown };
  join: RoomPlayer;
  leave: { player: string; reason: RoomLeaveReason };
  /** The host changed: the old host left or handed over. `null` when the room is empty. */
  host: { player: string | null };
  /** A shared state key changed. `deleted` is `true` when it was removed. */
  state: { key: string; value: unknown; version: number; by: string; deleted?: true };
  /** The host changed the room's settings. */
  room: RoomInfo;
  /**
   * The connection closed. Codes: 1000 you left, 1001 the server restarted (rejoin), 1006 network loss
   * (rejoin), 4001 bad ticket, 4004 room not found, 4009 room full or locked, 4010 kicked, 4011 you joined
   * from somewhere else, 4029 rate limited.
   */
  close: { code: number; reason: string };
  /** A message without a promise failed, e.g. a relay that was too large. */
  error: { code: string; message: string };
}

/** Options for room messages. */
export interface SendOptions {
  /** Player ids to send to. Default: everyone else in the room. */
  to?: string[];
}

/** Options for shared state writes. */
export interface StateWriteOptions {
  /** Write only if the key is still at this version (`0` = doesn't exist yet); rejects with `conflict` otherwise. */
  ifVersion?: number;
}

/** Changes the host can make to a room. */
export interface RoomUpdate {
  metadata?: Record<string, unknown>;
  visibility?: "public" | "private";
  locked?: boolean;
  capacity?: number;
}

/**
 * A connected realtime room: relay messages, shared state, and host controls. Get one from
 * {@link MultiplayerModule.join} or {@link MultiplayerModule.matchmake}.
 */
export interface Room {
  /** The room code. Share {@link RoomInfo.inviteUrl} to invite people. */
  readonly code: string;
  /** Your player id in the room. */
  readonly you: string;
  /** Settings, updated as `room` events arrive. */
  readonly info: RoomInfo;
  /** Everyone in the room, including you, in join order. */
  readonly players: readonly RoomPlayer[];
  /** `true` when you are the host. The host runs authoritative logic and can kick players. */
  readonly isHost: boolean;
  /** `true` until the connection closes. */
  readonly connected: boolean;
  /** A shared state value, or `undefined`. */
  get<T = unknown>(key: string): T | undefined;
  /** A shared state value with its version, for compare-and-set. */
  entry(key: string): RoomStateEntry | undefined;
  /** Every shared state key. */
  keys(): string[];
  /** Relays `data` (any JSON, up to 16 KB) to the other players. Fire and forget; ordered per sender. */
  send(data: unknown, options?: SendOptions): void;
  /** Writes a shared state key for everyone. Resolves with the new version. */
  setState(key: string, value: unknown, options?: StateWriteOptions): Promise<number>;
  /** Deletes a shared state key. */
  deleteState(key: string, options?: StateWriteOptions): Promise<void>;
  /** Host only: changes the room's settings. */
  update(changes: RoomUpdate): Promise<void>;
  /** Host only: removes a player from the room. */
  kick(playerId: string): Promise<void>;
  /** Host only: makes another player the host. */
  transferHost(playerId: string): Promise<void>;
  /** Listens for a room event. Returns a function that removes the listener. */
  on<E extends keyof RoomEvents>(event: E, listener: (data: RoomEvents[E]) => void): () => void;
  /** Leaves the room and frees your seat. */
  leave(): void;
  /** Reconnects to the same room after a drop, keeping your seat if you're back within 10 seconds. */
  rejoin(): Promise<Room>;
}

/** Options for {@link MultiplayerModule.matchmake}. */
export interface MatchmakeOptions {
  /** Players are only matched within the same mode. */
  mode: string;
  /** Smallest group to start with, 2 to 16. Default 2. */
  minPlayers?: number;
  /** Largest group. Default `minPlayers`. The matcher fills up to this, then settles for `minPlayers` after 10 seconds. */
  maxPlayers?: number;
  /** Matches players with similar skill first; the window widens the longer they wait. */
  skill?: number;
  /** Only matches players with the same region, e.g. `eu`. */
  region?: string;
  /** Give up after this many seconds, 5 to 300. Default 60. */
  timeoutSeconds?: number;
  /** Cancels the search. */
  signal?: AbortSignal;
}

/** A player in a turn-based match. */
export interface MatchPlayer {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  /** Turn order, starting at 0. */
  seat: number;
  status: "invited" | "joined" | "left";
  /** `true` for you. */
  isCurrentPlayer: boolean;
}

/** A turn-based match. Players take turns, online or not; the state lives on Infinite Gamer. */
export interface Match {
  id: string;
  mode: string;
  /** `waiting` until enough players join, then `active`, then `finished`. */
  status: "waiting" | "active" | "finished" | "cancelled";
  open: boolean;
  minPlayers: number;
  maxPlayers: number;
  players: MatchPlayer[];
  /** The shared game state (any JSON up to 64 KB). */
  state: unknown;
  /** Pass it back as `version` with the next turn. */
  version: number;
  /** Whose turn it is, or `null` when the match isn't active. */
  turn: { playerId: string; number: number; deadline: string | null } | null;
  lastTurn: { playerId: string; number: number; data: unknown; at: string } | null;
  result: { winners: string[]; reason: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** Options for {@link MatchesModule.create}. */
export interface CreateMatchOptions {
  mode?: string;
  /** Players needed to start, 2 to 16. Default 2. */
  minPlayers?: number;
  /** Default `minPlayers`. */
  maxPlayers?: number;
  /** Anyone can join open matches through {@link MatchesModule.quick}. Default `false`. */
  open?: boolean;
  /** Player ids to invite, e.g. from {@link FriendsModule.list}. They get a notification. */
  invite?: string[];
  /** The starting state. */
  state?: unknown;
  /** Seconds each player has for a turn, 60 seconds to 30 days. A missed turn passes to the next player. */
  turnTimeoutSeconds?: number;
}

/** Options for {@link MatchesModule.quick}. */
export interface QuickMatchOptions {
  mode?: string;
  minPlayers?: number;
  maxPlayers?: number;
  /** The starting state if a new match is created. */
  state?: unknown;
  turnTimeoutSeconds?: number;
}

/** A turn for {@link MatchesModule.submitTurn}. */
export interface TurnSubmission {
  /** The match version you read; rejects with `conflict` if another turn landed first. */
  version: number;
  /** The new shared state. */
  state: unknown;
  /** A description of the move, kept with the turn (up to 8 KB). */
  data?: unknown;
  /** Whose turn is next. Default: the next player by seat. */
  nextPlayer?: string;
  /** Ends the match with these winners (empty for a draw). */
  finish?: { winners: string[] };
}

/** Presence of a friend: `playing` means in some game, `online` means on Infinite Gamer. */
export type PresenceStatus = "offline" | "online" | "playing";

/** One of the player's friends, as your game sees them. */
export interface Friend {
  /** Studio-scoped player id. */
  id: string;
  displayName: string;
  avatarUrl: string | null;
  presence: PresenceStatus;
  /** `true` when they're playing this game right now. */
  inThisGame: boolean;
}

/** Remote config for this player: your values with matching overrides applied. */
export interface RemoteConfig {
  values: Record<string, unknown>;
  /** The published version, `0` when nothing is published. */
  version: number;
  /** Ids of the overrides that matched this player. */
  overrides: string[];
}

/** A leaderboard as declared in `infinitegamer.json`. */
export interface ManifestLeaderboard {
  id: string;
  name?: string;
  /** `desc` when higher is better (default), `asc` for times. */
  sort?: "asc" | "desc";
}

/** An achievement as declared in `infinitegamer.json`. */
export interface ManifestAchievement {
  id: string;
  name?: string;
  description?: string;
  points?: number;
  hidden?: boolean;
}

/** The parts of `infinitegamer.json` mock mode reads. */
export interface MockManifest {
  leaderboards?: ManifestLeaderboard[];
  achievements?: ManifestAchievement[];
}

/** Settings for mock mode. Ignored when the game runs inside the shell. */
export interface MockOptions {
  /**
   * `"auto"` (default) mocks only outside the shell, `true` always mocks, `false` never mocks
   * (calls outside the shell reject with `not_in_shell`).
   */
  enabled?: boolean | "auto";
  /** Leaderboards and achievements to fake. Defaults to the `infinitegamer.json` fetched from {@link MockOptions.manifestUrl}. */
  manifest?: MockManifest;
  /** Where to fetch `infinitegamer.json` when no `manifest` is given. Default `/infinitegamer.json`; `false` skips the fetch. */
  manifestUrl?: string | false;
  /** Overrides for the fake player. Default: `{ id: "mock-player", displayName: "Developer", isGuest: false }`. */
  player?: Partial<Player>;
  /** Keep saves, scores, and achievements in `localStorage` across reloads (default `true`), or only in memory. */
  persist?: boolean;
  /** Turn off console logging of analytics, lifecycle calls, and feedback. */
  quiet?: boolean;
  /** Values for {@link RemoteConfigModule}. Default `{}`. */
  remoteConfig?: Record<string, unknown>;
  /** Products for {@link PaymentsModule} in mock mode, where every purchase succeeds for free. Default `[]`. */
  products?: Product[];
}

/** Options for {@link IgClient.init}. */
export interface InitOptions {
  /** Mock mode: `true` forces it, `false` forbids it, or pass {@link MockOptions}. Default: automatic. */
  mock?: boolean | "auto" | MockOptions;
  /** How long to wait for the shell to answer the handshake before falling back to mock mode. Default 10 000 ms. */
  handshakeTimeoutMs?: number;
  /** Report uncaught errors and unhandled rejections to the shell as `IG.error(...)`. Default `false`. */
  captureErrors?: boolean;
  /** Extra shell origins to trust, for self-hosted test shells. `https://infinitegamer.net` and loopback origins are always trusted. */
  trustedShellOrigins?: string[];
  /**
   * Your game's id (the client id under Settings, Hosting elsewhere, in Studio). Set it when the game also runs on
   * your own site: outside Infinite Gamer the SDK then uses connected mode, where players sign in with Infinite
   * Gamer and every module talks to the platform, instead of mock mode. The site's origin must be registered for
   * the game. Ignored inside the Infinite Gamer shell. `mock: true` still forces mock mode.
   *
   * @example
   * ```ts
   * await IG.init({ gameId: "3f0c9a52-6f1e-4c55-9a8e-2b7d4f1e0c11" });
   * ```
   */
  gameId?: string;
  /** Where Infinite Gamer is, for connected mode. Default `https://infinitegamer.net`; change it only to test against a local copy. */
  platformOrigin?: string;
}

/** Options for {@link createClient}. */
export interface ClientOptions {
  /** The window the game runs in. Defaults to the global `window`; tests pass a fake. */
  window?: Window;
  /** Request timeout in milliseconds for non-interactive calls. Default 10 000. */
  timeoutMs?: number;
}

/** Something that makes sound and should follow the shell's pause and mute. */
export type AudioTarget = AudioContext | HTMLMediaElement;

/** A gameplay clip recorded with {@link ClipsModule.record}. */
export interface Clip {
  /** The video: `video/webm` (Chrome, Firefox, Android) or `video/mp4` (Safari). */
  blob: Blob;
  /** The container and codecs the browser picked, e.g. `video/webm;codecs=vp9`. */
  mimeType: string;
  /** Recorded length in milliseconds. */
  durationMs: number;
}

/** Options for {@link ClipsModule.record}. */
export interface ClipRecordOptions {
  /** The canvas to record. WebGL canvases need `preserveDrawingBuffer: true` in some browsers, or a draw each frame. */
  canvas: HTMLCanvasElement;
  /** Stop on its own after this many seconds. Default 30, at most 60. */
  maxSeconds?: number;
  /** Frame rate to capture at. Default 30, at most 60. */
  fps?: number;
  /** Sound to mix in, e.g. `audioContext.createMediaStreamDestination().stream`. Default: no sound. */
  audio?: MediaStream;
  /** Target video bitrate in bits per second. Default 2 500 000. */
  videoBitsPerSecond?: number;
}

/** A recording in progress, from {@link ClipsModule.record}. */
export interface ClipRecording {
  /** Stops recording and resolves with the clip. Resolves with the same clip if it already stopped on its own. */
  stop(): Promise<Clip>;
  /** Stops and throws the recording away. */
  cancel(): void;
  /** True until it stops, is canceled, or reaches `maxSeconds`. */
  readonly recording: boolean;
}

/** Options for {@link ClipsModule.share}. */
export interface ClipShareOptions {
  /** A caption to suggest in the share sheet, up to 200 characters. The shell adds a link to the game. */
  text?: string;
}

/** Your part in a stage game: watching, waiting in line (including the "you're up" check), or playing. */
export type StageRole = "viewer" | "waiting" | "player";

/**
 * Why a turn ended: the game called {@link Stage.endTurn} (`ended`), the turn ran out of time (`timeout`), no state
 * updates for the idle timeout (`idle`), the player dropped and didn't come back in time (`disconnected`), the player
 * declined or missed the "you're up" check (`declined`), or the player left (`left`).
 */
export type StageTurnEndReason = "ended" | "timeout" | "idle" | "disconnected" | "declined" | "left";

/** A player on stage as viewers see them. `name` is `null` when it's hidden (the game's setting, or a player under 13). */
export interface StagePlayer {
  /** Studio-scoped player id, like {@link Player.id}. */
  id: string;
  name: string | null;
}

/** What a turn achieved. The shell shows `score` (or else `summary`) to viewers as "Last turn". Up to 1 KB of JSON. */
export interface StageTurnResult {
  score?: number;
  /** Short text, up to 80 characters, e.g. `"Reached level 4"`. */
  summary?: string;
  /** Anything else your game wants viewers' copies to see. */
  data?: unknown;
}

/** A state update from the player on stage. */
export interface StageSnapshot<S = unknown> {
  state: S;
  /** When the server received it, in server milliseconds (see {@link Stage.serverNow}). Use it to interpolate. */
  at: number;
  /** Increases by one with every update. */
  seq: number;
}

/** The turn rules the game set in the developer portal. */
export interface StageRules {
  maxTurnSeconds: number;
  readyCheckSeconds: number;
  /** A turn with no {@link Stage.update} calls for this long ends as `idle`. */
  idleTimeoutSeconds: number;
  maxQueueLength: number;
  /** When `false`, guests can watch but must sign in to join the line. */
  allowGuests: boolean;
}

/** Who's on stage. `phase` is `ready` while they answer the "you're up" check. Times are server milliseconds. */
export interface StageCurrent {
  player: StagePlayer;
  turn: number;
  phase: "ready" | "playing";
  startedAt: number;
  /** When the turn (or the ready check) runs out. */
  endsAt: number;
}

/** How the previous turn ended. */
export interface StageLastTurn {
  player: StagePlayer;
  turn: number;
  reason: StageTurnEndReason;
  result: StageTurnResult | null;
  endedAt: number;
}

/** The stage as you see it. */
export interface StageStatus {
  role: StageRole;
  /** Your place in line (1 = next) while `waiting`, else `null`. */
  position: number | null;
  /** Estimated seconds until your turn while `waiting`. */
  waitSeconds: number | null;
  queueLength: number;
  viewers: number;
  current: StageCurrent | null;
  lastTurn: StageLastTurn | null;
  /** The latest state of the current turn, so you can render as soon as you start watching. */
  latest: StageSnapshot | null;
  /** Set while you're being asked whether you're ready. */
  readyCheck: { expiresAt: number } | null;
  rules: StageRules;
  /** The server's clock when this was read. */
  now: number;
}

/** Events a {@link Stage} emits. Times are server milliseconds. */
export interface StageEvents<S = unknown> {
  /** Your role changed. */
  role: { role: StageRole; position: number | null };
  /** Your place in line moved, or the estimate changed. */
  position: { position: number; queueLength: number; waitSeconds: number };
  /** You're up: call {@link Stage.ready} before `expiresAt` or the turn is skipped. The shell shows its own prompt too. */
  readyCheck: { expiresAt: number };
  /** A turn started. `you` is `true` when it's yours. Clear the viewer view; {@link Stage.latest} is `null` until the first update. */
  turnStart: { player: StagePlayer; turn: number; startedAt: number; endsAt: number; you: boolean };
  turnEnd: { player: StagePlayer; turn: number; reason: StageTurnEndReason; result: StageTurnResult | null; endedAt: number; you: boolean };
  /** A state update from the player on stage. The player who sent it doesn't get it back. */
  state: StageSnapshot<S>;
  /** How many are watching (players included) and waiting. */
  viewers: { count: number; queueLength: number };
}

/** Two snapshots to blend for smooth viewer rendering, from {@link Stage.sample}. */
export interface StageSample<S = unknown> {
  from: StageSnapshot<S>;
  to: StageSnapshot<S>;
  /** How far from `from` to `to`, 0 to 1. */
  t: number;
}

/** Timings for the simulated stage in mock mode, in seconds. */
export interface StageMockOptions {
  /** How long the simulated players ahead of you play. Default 5. */
  otherTurnSeconds?: number;
  /** Simulated players in line ahead of you when you join. Default 1. */
  playersAhead?: number;
  /** Default 10. */
  readyCheckSeconds?: number;
  /** Default 60. */
  maxTurnSeconds?: number;
  /** Default 20. */
  idleTimeoutSeconds?: number;
}

/** Options for {@link StageModule.watch}. */
export interface StageWatchOptions {
  /** Mock mode only: how the simulated stage behaves. */
  mock?: StageMockOptions;
}

/**
 * A game's stage: one player at a time, everyone else waits in line or watches. Get it from
 * {@link StageModule.watch}. The player on stage sends small state updates with {@link Stage.update}; every
 * viewer's copy of the game renders them in viewer mode.
 */
export interface Stage<S = unknown> {
  /** Your current role. Starts as `viewer`. */
  readonly role: StageRole;
  /** Your place in line (1 = next) while waiting. */
  readonly position: number | null;
  /** Estimated seconds until your turn while waiting. */
  readonly waitSeconds: number | null;
  readonly queueLength: number;
  readonly viewers: number;
  /** Who's on stage, if anyone. */
  readonly current: StageCurrent | null;
  readonly lastTurn: StageLastTurn | null;
  /** Set while you're being asked whether you're ready. */
  readonly readyCheck: { expiresAt: number } | null;
  readonly rules: StageRules;
  /** Everything above in one object. */
  status(): StageStatus;
  /**
   * Gets in line. When nobody is waiting and the stage is free, your turn starts right away (no ready check).
   * Rejects with `conflict` when the line is full and `forbidden` for guests when the game requires sign-in.
   */
  join(): Promise<{ role: StageRole; position: number | null }>;
  /** Leaves the line, or gives up your turn (it ends as `left`). */
  leave(): Promise<void>;
  /** Answers the "you're up" check. `false` skips your turn. */
  ready(accept?: boolean): Promise<void>;
  /**
   * Player only: sends your game state to viewers. Call it as often as you like; updates are coalesced to 20 a
   * second, and only the latest is sent. Keep it small: at most 8 KB of JSON. Ignored unless you're the `player`.
   * Throws `payload_too_large` for bigger states.
   */
  update(state: S): void;
  /** Player only: ends your turn, with an optional result viewers see as "Last turn". Sends any pending update first. */
  endTurn(result?: StageTurnResult): Promise<void>;
  /** The latest state of the current turn, or `null`. Late viewers get it on {@link StageModule.watch}. */
  latest(): StageSnapshot<S> | null;
  /**
   * Viewer helper: the two buffered snapshots around `serverNow() - delayMs` and how far between them, so you can
   * interpolate positions smoothly. `null` before the first update of a turn.
   *
   * @param delayMs How far behind live to render. Default 100 (two updates at 20 a second).
   */
  sample(delayMs?: number): StageSample<S> | null;
  /** The server's clock, estimated from the last status. Compare it with `at`, `endsAt`, and `expiresAt`. */
  serverNow(): number;
  /** Listens for a stage event. Returns a function that removes the listener. */
  on<E extends keyof StageEvents<S>>(event: E, listener: (data: StageEvents<S>[E]) => void): () => void;
}
