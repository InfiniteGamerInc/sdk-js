import { z } from "zod";
import { MATCH_LIMITS, MATCHMAKING_LIMITS, REALTIME_LIMITS } from "./limits.ts";

/**
 * The realtime room protocol spoken on `wss://infinitegamer.net/rt`, room tickets, stage games, matchmaking,
 * turn-based matches, friends as games see them, and remote config as games receive it.
 *
 * Realtime wire format: one JSON object per WebSocket text frame, discriminated by `t`. Clients send
 * {@link RtClientMessage}s; the server sends {@link RtServerMessage}s. A client message with a `ref`
 * gets an `ack` (or an `error` with the same `ref`).
 */
export const REALTIME_PATH = "/rt";
export const REALTIME_PROTOCOL_VERSION = 1 as const;

/** WebSocket close codes the realtime server uses (4000-4999 are application codes). */
export const REALTIME_CLOSE_CODES = {
  normal: 1000,
  /** The instance is draining for a deploy; get a new ticket and reconnect. */
  goingAway: 1001,
  badRequest: 4000,
  /** Missing, invalid, expired, or already-used ticket. */
  unauthenticated: 4001,
  forbidden: 4003,
  roomNotFound: 4004,
  /** The room is full or locked. */
  roomFull: 4009,
  kicked: 4010,
  /** The same player joined the room from another connection. */
  replaced: 4011,
  rateLimited: 4029,
} as const;
export type RealtimeCloseCode = (typeof REALTIME_CLOSE_CODES)[keyof typeof REALTIME_CLOSE_CODES];

export const roomVisibility = z.enum(["public", "private"]);
export type RoomVisibility = z.infer<typeof roomVisibility>;

/** Room codes as in invite links: uppercase letters and digits. */
export const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,12}$/;
const mode = z.string().max(40).regex(/^[a-z0-9_-]*$/);
const metadata = z.record(z.string(), z.unknown());

/** Options for a new room. */
export const roomCreateOptions = z.object({
  capacity: z.number().int().min(1).max(REALTIME_LIMITS.roomCapacityMax).optional(),
  /** `private` rooms (the default) are joinable only by code; `public` rooms can be quick-joined. */
  visibility: roomVisibility.optional(),
  metadata: metadata.optional(),
});
export type RoomCreateOptions = z.infer<typeof roomCreateOptions>;

/**
 * What a room ticket asks for: join a room by code, create one, or (neither) quick-join a public room
 * of the mode. Room codes are case-insensitive.
 */
export const roomTicketRequest = z.object({
  mode: z.string().max(40).optional(),
  room: z.string().max(64).optional(),
  create: roomCreateOptions.optional(),
});
export type RoomTicketRequest = z.infer<typeof roomTicketRequest>;

export const roomTicket = z.object({
  /** WebSocket URL to connect to, e.g. `wss://infinitegamer.net/rt`. Pass the ticket as `?ticket=`. */
  url: z.string(),
  ticket: z.string(),
  expiresAt: z.string(),
});
export type RoomTicket = z.infer<typeof roomTicket>;

export const roomPlayer = z.object({
  id: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  joinedAt: z.number().int(),
});
export type RoomPlayer = z.infer<typeof roomPlayer>;

export const roomInfo = z.object({
  code: z.string(),
  mode: z.string(),
  capacity: z.number().int(),
  visibility: roomVisibility,
  locked: z.boolean(),
  metadata,
  hostId: z.string().nullable(),
  /** `https://infinitegamer.net/play?game=<slug>&room=<code>`: opens the game in the shell and joins the room. */
  inviteUrl: z.string(),
});
export type RoomInfo = z.infer<typeof roomInfo>;

export interface RoomStateEntry {
  value: unknown;
  version: number;
}

const ref = z.string().max(32).optional();
const playerId = z.string().min(1).max(64);
const stateKey = z.string().min(1).max(REALTIME_LIMITS.stateKeyMax);

/** Messages a client sends on the realtime socket. */
export const rtClientMessage = z.discriminatedUnion("t", [
  /** Relay `data` to every other player, or only to the ids in `to`. */
  z.object({ t: z.literal("send"), data: z.unknown(), to: z.array(playerId).max(REALTIME_LIMITS.roomCapacityMax).optional(), ref }),
  /** Write a shared state key. With `ifVersion`, fails with `conflict` unless the key is at that version (0 = absent). */
  z.object({ t: z.literal("state.set"), key: stateKey, value: z.unknown(), ifVersion: z.number().int().min(0).optional(), ref }),
  z.object({ t: z.literal("state.delete"), key: stateKey, ifVersion: z.number().int().min(0).optional(), ref }),
  /** Host only. */
  z.object({
    t: z.literal("room.update"),
    metadata: metadata.optional(),
    visibility: roomVisibility.optional(),
    locked: z.boolean().optional(),
    capacity: z.number().int().min(1).max(REALTIME_LIMITS.roomCapacityMax).optional(),
    ref,
  }),
  /** Host only. */
  z.object({ t: z.literal("kick"), player: playerId, ref }),
  /** Host only. */
  z.object({ t: z.literal("host.transfer"), player: playerId, ref }),
  z.object({ t: z.literal("ping"), ref }),
  z.object({ t: z.literal("leave") }),
  /** Stage connections only: get in line. Answered with an `ack` and a `stage.role`. */
  z.object({ t: z.literal("stage.join"), ref }),
  /** Stage connections only: leave the line, or give up the turn (ends it as `left`). */
  z.object({ t: z.literal("stage.leave"), ref }),
  /** Stage connections only: answer the "you're up" check. Declining (or not answering in time) skips your turn. */
  z.object({ t: z.literal("stage.ready"), accept: z.boolean(), ref }),
  /** Stage connections only, active player only: a state update for viewers. Rate- and size-limited by `STAGE_LIMITS`. */
  z.object({ t: z.literal("stage.update"), state: z.unknown() }),
  /** Stage connections only, active player only: the turn is over. */
  z.object({ t: z.literal("stage.end"), result: z.unknown().optional(), ref }),
]);
export type RtClientMessage = z.infer<typeof rtClientMessage>;

// ---------------------------------------------------------------------------------------------
// Stage games: one player at a time, everyone else waits in line or watches

export const STAGE_ROLES = ["viewer", "waiting", "player"] as const;
export type StageRole = (typeof STAGE_ROLES)[number];

/**
 * Why a turn ended: the game called `endTurn` (`ended`), the turn ran out of time (`timeout`), no state updates
 * for `idleTimeoutSeconds` (`idle`), the player dropped and didn't come back in time (`disconnected`), the player
 * declined or missed the "you're up" check (`declined`), or the player left the stage (`left`).
 */
export const STAGE_TURN_END_REASONS = ["ended", "timeout", "idle", "disconnected", "declined", "left"] as const;
export type StageTurnEndReason = (typeof STAGE_TURN_END_REASONS)[number];

/** A player on stage as viewers see them. `name` is `null` when it's hidden. */
export const stagePlayer = z.object({ id: z.string(), name: z.string().nullable() });
export type StagePlayer = z.infer<typeof stagePlayer>;

/** What a game may report when a turn ends; the shell shows `score` or `summary` as "Last turn". */
export const stageTurnResult = z.object({
  score: z.number().finite().optional(),
  summary: z.string().max(80).optional(),
  data: z.unknown().optional(),
});
export type StageTurnResult = z.infer<typeof stageTurnResult>;

/** A state update. `at` is the server's clock (ms) when it arrived; `seq` increases by one per update. */
export const stageSnapshot = z.object({ state: z.unknown(), at: z.number(), seq: z.number().int() });
export type StageSnapshot = z.infer<typeof stageSnapshot>;

/** The turn rules a game set in the developer portal. */
export const stageRules = z.object({
  maxTurnSeconds: z.number(),
  readyCheckSeconds: z.number(),
  idleTimeoutSeconds: z.number(),
  maxQueueLength: z.number().int(),
  allowGuests: z.boolean(),
});
export type StageRules = z.infer<typeof stageRules>;

/** The stage as one connection sees it: sent on connect (`stage.welcome`) and returned by the `stage.watch` bridge call. */
export const stageStatus = z.object({
  role: z.enum(STAGE_ROLES),
  /** Your place in line (1 = next), while `waiting`. */
  position: z.number().int().nullable(),
  /** Estimated seconds until your turn, while `waiting`. */
  waitSeconds: z.number().int().nullable(),
  queueLength: z.number().int(),
  viewers: z.number().int(),
  /** Who's on stage: `ready` while they answer the "you're up" check, then `playing`. Times are server ms. */
  current: z
    .object({ player: stagePlayer, turn: z.number().int(), phase: z.enum(["ready", "playing"]), startedAt: z.number(), endsAt: z.number() })
    .nullable(),
  lastTurn: z
    .object({ player: stagePlayer, turn: z.number().int(), reason: z.enum(STAGE_TURN_END_REASONS), result: stageTurnResult.nullable(), endedAt: z.number() })
    .nullable(),
  /** The latest state update of the current turn, so late viewers can render right away. */
  latest: stageSnapshot.nullable(),
  /** Set while you're being asked whether you're ready. */
  readyCheck: z.object({ expiresAt: z.number() }).nullable(),
  rules: stageRules,
  /** The server's clock (ms) when this was sent, for converting `at` and deadlines to local time. */
  now: z.number(),
});
export type StageStatus = z.infer<typeof stageStatus>;
export type StageCurrent = NonNullable<StageStatus["current"]>;
export type StageLastTurn = NonNullable<StageStatus["lastTurn"]>;

export type RtLeaveReason = "left" | "disconnected" | "kicked";

/** Messages the realtime server sends. */
export type RtServerMessage =
  | {
      t: "welcome";
      protocol: typeof REALTIME_PROTOCOL_VERSION;
      you: string;
      room: RoomInfo;
      players: RoomPlayer[];
      state: Record<string, RoomStateEntry>;
    }
  | { t: "joined"; player: RoomPlayer }
  | { t: "left"; player: string; reason: RtLeaveReason }
  | { t: "host"; player: string | null }
  | { t: "msg"; from: string; data: unknown }
  | { t: "state"; key: string; value: unknown; version: number; by: string; deleted?: true }
  | { t: "room"; room: RoomInfo }
  | { t: "ack"; ref: string; version?: number; role?: StageRole; position?: number | null }
  | { t: "error"; ref?: string; code: string; message: string; details?: unknown }
  | { t: "pong"; ref?: string; now: number }
  | { t: "closing"; reason: "shutdown" | "kicked" | "replaced" }
  | { t: "stage.welcome"; protocol: typeof REALTIME_PROTOCOL_VERSION; you: string; status: StageStatus }
  | { t: "stage.role"; role: StageRole; position: number | null }
  | { t: "stage.position"; position: number; queueLength: number; waitSeconds: number }
  | { t: "stage.readyCheck"; expiresAt: number }
  | { t: "stage.turnStart"; player: StagePlayer; turn: number; startedAt: number; endsAt: number }
  | { t: "stage.turnEnd"; player: StagePlayer; turn: number; reason: StageTurnEndReason; result: StageTurnResult | null; endedAt: number }
  | { t: "stage.state"; state: unknown; at: number; seq: number }
  | { t: "stage.viewers"; count: number; queueLength: number };

// ---------------------------------------------------------------------------------------------
// Matchmaking

export const matchmakingRequest = z.object({
  mode: mode.min(1),
  minPlayers: z.number().int().min(2).max(MATCHMAKING_LIMITS.playersMax).default(2),
  /** Defaults to `minPlayers`. */
  maxPlayers: z.number().int().min(2).max(MATCHMAKING_LIMITS.playersMax).optional(),
  /** Players are matched with similar skill; the window widens the longer they wait. */
  skill: z.number().finite().optional(),
  /** Only players with the same region are matched. */
  region: z.string().max(32).regex(/^[a-z0-9-]+$/).optional(),
  timeoutSeconds: z.number().int().min(5).max(MATCHMAKING_LIMITS.timeoutSecondsMax).optional(),
});
export type MatchmakingRequest = z.input<typeof matchmakingRequest>;

export const MATCHMAKING_STATUSES = ["queued", "matched", "timeout", "cancelled"] as const;
export const matchmakingStatus = z.object({
  requestId: z.string(),
  status: z.enum(MATCHMAKING_STATUSES),
  expiresAt: z.string(),
  /** Set once `matched`: a ticket for the room the matcher created. */
  ticket: roomTicket.optional(),
});
export type MatchmakingStatus = z.infer<typeof matchmakingStatus>;

// ---------------------------------------------------------------------------------------------
// Turn-based matches

export const MATCH_STATUSES = ["waiting", "active", "finished", "cancelled"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const matchPlayer = z.object({
  id: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  seat: z.number().int(),
  status: z.enum(["invited", "joined", "left"]),
  isCurrentPlayer: z.boolean(),
});

export const match = z.object({
  id: z.string(),
  mode: z.string(),
  status: z.enum(MATCH_STATUSES),
  open: z.boolean(),
  minPlayers: z.number().int(),
  maxPlayers: z.number().int(),
  players: z.array(matchPlayer),
  state: z.unknown(),
  /** Increments on every turn; pass it back as `version` when submitting the next one. */
  version: z.number().int(),
  turn: z.object({ playerId: z.string(), number: z.number().int(), deadline: z.string().nullable() }).nullable(),
  lastTurn: z.object({ playerId: z.string(), number: z.number().int(), data: z.unknown(), at: z.string() }).nullable(),
  result: z.object({ winners: z.array(z.string()), reason: z.string() }).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Match = z.infer<typeof match>;

const matchSize = {
  minPlayers: z.number().int().min(2).max(MATCH_LIMITS.playersMax).default(2),
  maxPlayers: z.number().int().min(2).max(MATCH_LIMITS.playersMax).optional(),
};
const turnTimeout = z.number().int().min(MATCH_LIMITS.turnTimeoutSecondsMin).max(MATCH_LIMITS.turnTimeoutSecondsMax).optional();

export const createMatchInput = z.object({
  mode: mode.default(""),
  ...matchSize,
  /** Anyone can join an open match (see `matches.quick`); otherwise only invited players. */
  open: z.boolean().default(false),
  /** Studio-scoped player ids to invite: friends, or players met in a room. */
  invite: z.array(playerId).max(MATCH_LIMITS.playersMax - 1).default([]),
  state: z.unknown().optional(),
  turnTimeoutSeconds: turnTimeout,
});
export type CreateMatchInput = z.input<typeof createMatchInput>;

/** Join the oldest open match of the mode that has room, or create an open one. */
export const quickMatchInput = z.object({
  mode: mode.default(""),
  ...matchSize,
  state: z.unknown().optional(),
  turnTimeoutSeconds: turnTimeout,
});
export type QuickMatchInput = z.input<typeof quickMatchInput>;

export const submitTurnInput = z.object({
  /** The match version you read; fails with `conflict` if another turn landed first. */
  version: z.number().int().min(0),
  state: z.unknown(),
  /** A description of the move, kept with the turn (e.g. for replays or a "last move" display). */
  data: z.unknown().optional(),
  /** Whose turn is next; defaults to the next joined player by seat. */
  nextPlayer: playerId.optional(),
  /** Ends the match. */
  finish: z.object({ winners: z.array(playerId).max(MATCH_LIMITS.playersMax) }).optional(),
});
export type SubmitTurnInput = z.input<typeof submitTurnInput>;

// ---------------------------------------------------------------------------------------------
// Friends and presence

export const PRESENCE_STATUSES = ["offline", "online", "playing"] as const;
export const presenceStatus = z.enum(PRESENCE_STATUSES);
export type PresenceStatus = z.infer<typeof presenceStatus>;

/** A friend as a game sees them: studio-scoped id, never the account id. */
export const gameFriend = z.object({
  id: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  presence: presenceStatus,
  /** `true` when the friend is playing this game right now. */
  inThisGame: z.boolean(),
});
export type GameFriend = z.infer<typeof gameFriend>;

// ---------------------------------------------------------------------------------------------
// Remote config

/** Remote config values: top-level keys and any JSON value. */
export const remoteConfigValues = z.record(z.string().min(1).max(100), z.unknown());

/** What a game receives: base values with matching overrides applied. */
export const resolvedRemoteConfig = z.object({
  values: remoteConfigValues,
  /** `0` when nothing has been published. */
  version: z.number().int(),
  /** Ids of the overrides that matched this player. */
  overrides: z.array(z.string()),
});
export type ResolvedRemoteConfig = z.infer<typeof resolvedRemoteConfig>;
