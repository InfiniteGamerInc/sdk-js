/**
 * Limits the SDK enforces. A separate constant so the SDK bundle imports only these, not all of
 * {@link LIMITS} (it has a 10 KB budget).
 */
export const SDK_LIMITS = {
  saveKeyMax: 128,
  saveValueMaxBytes: 256 * 1024,
  savesPerGameMaxBytes: 5 * 1024 * 1024,
  savesPerGameMaxKeys: 200,
  analyticsEventNameMax: 64,
  analyticsPropsMaxBytes: 4 * 1024,
  analyticsEventsPerMinute: 120,
  leaderboardsPerGame: 50,
  achievementsPerGame: 500,
  feedbackBodyMax: 2000,
  identityTokenTtlSeconds: 3600,
} as const;

/**
 * Gameplay clips (`IG.clips`). Its own constant so the SDK's lazy recorder chunk imports only these;
 * the core SDK bundle doesn't import it.
 */
export const CLIP_LIMITS = {
  /** A recording stops itself after this long. */
  maxSeconds: 60,
  /** Length of a recording when the game doesn't pass `maxSeconds`. */
  defaultSeconds: 30,
  /** Largest clip the shell accepts for sharing (50 MiB; a literal, so bundles that don't use it can drop this object). */
  maxBytes: 52_428_800,
  /** Frame rate cap for recordings. */
  maxFps: 60,
  /** Caption the game can suggest for the share sheet. */
  shareTextMax: 200,
} as const;

/**
 * Stage games (`IG.stage`). Its own constant so the SDK's lazy stage chunk imports only these; the core
 * SDK bundle doesn't import it.
 */
export const STAGE_LIMITS = {
  /** Largest state update (JSON) the active player may send; the latest one is kept as the snapshot for new viewers. */
  stateMaxBytes: 8192,
  /** State updates per second from the active player. The SDK coalesces faster calls; the server drops the excess. */
  updatesPerSecond: 20,
  /** Largest turn result (JSON) passed to `endTurn`. */
  resultMaxBytes: 1024,
} as const;

// Literal numbers, not `a * b`: esbuild keeps objects with arithmetic in bundles that don't use them.

/** Realtime rooms (`IG.multiplayer`): tickets, messages, shared state, and reconnects. */
export const REALTIME_LIMITS = {
  /** Room tickets are single-use and expire this long after the shell issues them. */
  ticketTtlSeconds: 60,
  /** Largest WebSocket frame a client may send (JSON text). */
  messageMaxBytes: 16_384,
  /** Sustained messages per second per connection; short bursts up to `messageBurst` are allowed. */
  messagesPerSecond: 30,
  messageBurst: 60,
  roomCapacityDefault: 8,
  roomCapacityMax: 32,
  roomCodeLength: 6,
  roomMetadataMaxBytes: 2_048,
  stateKeyMax: 64,
  stateKeysMax: 256,
  stateValueMaxBytes: 16_384,
  stateMaxBytes: 262_144,
  /** A dropped connection keeps its seat (and host role) this long so the player can reconnect. */
  reconnectGraceSeconds: 10,
  /** Connections that send nothing (not even protocol pings) for this long are closed. */
  idleTimeoutSeconds: 60,
  /** Rooms idle this long (no joins, messages, or state writes) are deleted. */
  roomIdleTtlSeconds: 21_600,
} as const;

/** Matchmaking requests. The bounds at the end limit a game's own matchmaking settings. */
export const MATCHMAKING_LIMITS = {
  timeoutSecondsDefault: 60,
  timeoutSecondsMax: 300,
  playersMax: 16,
  /** Skill gap allowed at first; it widens by `skillWidenPerSecond` while players wait. */
  skillWindow: 100,
  skillWidenPerSecond: 10,
  /** After this long, a queue entry is matched with at least `minPlayers` instead of waiting for `maxPlayers`. */
  fillAfterSeconds: 10,
  /** Bounds for a game's own matchmaking settings (studio multiplayer settings). */
  timeoutSecondsMin: 5,
  skillWindowMax: 10_000,
  skillWidenPerSecondMax: 1_000,
  fillAfterSecondsMax: 300,
} as const;

/** Turn-based matches (`IG.matches`). */
export const MATCH_LIMITS = {
  playersMax: 16,
  stateMaxBytes: 65_536,
  turnDataMaxBytes: 8_192,
  turnTimeoutSecondsMin: 60,
  turnTimeoutSecondsMax: 2_592_000,
  activePerPlayerMax: 100,
} as const;
