import type { BridgeMethod, BridgeParams, BridgeResult } from "@infinitegamer/protocol/bridge";
import type { RtClientMessage, RtServerMessage } from "@infinitegamer/protocol/realtime";
import type {
  MatchmakeOptions,
  MultiplayerTicket,
  Room,
  RoomEvents,
  RoomInfo,
  RoomPlayer,
  RoomStateEntry,
  TicketRequest,
} from "./types.ts";

/*
 * The realtime room client. The CDN build loads it on first use as `ig.multiplayer.global.js`, so it must not
 * import runtime code from the core (that would duplicate it): everything it needs comes in through RoomDeps.
 */

/** The subset of WebSocket the room client uses. */
interface Socket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
}

export interface RoomDeps {
  call<M extends BridgeMethod>(method: M, params: BridgeParams<M>): Promise<BridgeResult<M>>;
  join(request: TicketRequest): Promise<Room>;
  error(code: string, message: string, details?: unknown): Error;
  WebSocket?: new (url: string) => Socket;
}

type Unref<T> = T extends unknown ? Omit<T, "ref"> : never;
type Listeners = { [E in keyof RoomEvents]?: Set<(data: never) => void> };

const CLOSE_ERRORS: Record<number, string> = {
  4000: "bad_request",
  4001: "unauthenticated",
  4003: "forbidden",
  4004: "not_found",
  4009: "conflict",
  4029: "rate_limited",
};

class RoomConnection implements Room {
  code = "";
  you = "";
  info = {} as RoomInfo;
  players: RoomPlayer[] = [];
  connected = false;
  private state = new Map<string, RoomStateEntry>();
  private listeners: Listeners = {};
  private pending = new Map<string, [(version: number) => void, (error: Error) => void]>();
  private seq = 0;

  constructor(
    private readonly ws: Socket,
    private readonly deps: RoomDeps,
  ) {}

  get isHost(): boolean {
    return this.info.hostId === this.you;
  }

  get<T = unknown>(key: string): T | undefined {
    return this.state.get(key)?.value as T | undefined;
  }

  entry(key: string): RoomStateEntry | undefined {
    const e = this.state.get(key);
    return e && { ...e };
  }

  keys(): string[] {
    return [...this.state.keys()];
  }

  send(data: unknown, options: { to?: string[] } = {}): void {
    this.out({ t: "send", data, to: options.to });
  }

  setState(key: string, value: unknown, options: { ifVersion?: number } = {}): Promise<number> {
    return this.request({ t: "state.set", key, value, ifVersion: options.ifVersion });
  }

  async deleteState(key: string, options: { ifVersion?: number } = {}): Promise<void> {
    await this.request({ t: "state.delete", key, ifVersion: options.ifVersion });
  }

  async update(changes: object): Promise<void> {
    await this.request({ ...changes, t: "room.update" });
  }

  async kick(player: string): Promise<void> {
    await this.request({ t: "kick", player });
  }

  async transferHost(player: string): Promise<void> {
    await this.request({ t: "host.transfer", player });
  }

  on<E extends keyof RoomEvents>(event: E, listener: (data: RoomEvents[E]) => void): () => void {
    const set = (this.listeners[event] ??= new Set());
    set.add(listener);
    return () => void set.delete(listener);
  }

  leave(): void {
    if (this.connected) this.ws.send(JSON.stringify({ t: "leave" }));
    this.ws.close(1000);
  }

  rejoin(): Promise<Room> {
    if (this.connected) this.ws.close(1000);
    return this.deps.join({ room: this.code, mode: this.info.mode });
  }

  handle(m: RtServerMessage): void {
    switch (m.t) {
      case "welcome":
        this.you = m.you;
        this.info = m.room;
        this.code = m.room.code;
        this.players = m.players;
        this.state = new Map(Object.entries(m.state));
        this.connected = true;
        return;
      case "joined":
        this.players = [...this.players.filter((p) => p.id !== m.player.id), m.player];
        return this.emit("join", m.player);
      case "left":
        this.players = this.players.filter((p) => p.id !== m.player);
        return this.emit("leave", { player: m.player, reason: m.reason });
      case "host":
        this.info = { ...this.info, hostId: m.player };
        return this.emit("host", { player: m.player });
      case "msg":
        return this.emit("message", { from: m.from, data: m.data });
      case "state": {
        const { t: _, ...change } = m;
        if (m.deleted) this.state.delete(m.key);
        else this.state.set(m.key, { value: m.value, version: m.version });
        return this.emit("state", change as RoomEvents["state"]);
      }
      case "room":
        this.info = m.room;
        return this.emit("room", m.room);
      case "ack":
        this.pending.get(m.ref)?.[0](m.version ?? 0);
        this.pending.delete(m.ref);
        return;
      case "error": {
        const p = m.ref === undefined ? undefined : this.pending.get(m.ref);
        if (m.ref !== undefined) this.pending.delete(m.ref);
        if (p) p[1](this.deps.error(m.code, m.message, m.details));
        else this.emit("error", { code: m.code, message: m.message });
      }
    }
  }

  closed(code: number, reason: string): void {
    this.connected = false;
    for (const [, reject] of this.pending.values()) reject(this.deps.error("internal", "The room connection closed"));
    this.pending.clear();
    this.emit("close", { code, reason });
  }

  private emit<E extends keyof RoomEvents>(event: E, data: RoomEvents[E]): void {
    for (const listener of [...(this.listeners[event] ?? [])]) {
      try {
        (listener as (d: RoomEvents[E]) => void)(data);
      } catch (err) {
        setTimeout(() => {
          throw err;
        });
      }
    }
  }

  private out(msg: RtClientMessage): void {
    if (!this.connected) throw this.deps.error("conflict", "The room connection is closed");
    this.ws.send(JSON.stringify(msg));
  }

  private request(msg: Unref<RtClientMessage>): Promise<number> {
    return new Promise((resolve, reject) => {
      const ref = String(++this.seq);
      this.pending.set(ref, [resolve, reject]);
      try {
        this.out({ ...msg, ref } as RtClientMessage);
      } catch (err) {
        this.pending.delete(ref);
        reject(err);
      }
    });
  }
}

/** Connects with a ticket and resolves once the server has sent the room's state. */
export function connect(ticket: MultiplayerTicket, deps: RoomDeps): Promise<Room> {
  const ws = ticket.url.startsWith("mock:")
    ? loopback(ticket.ticket)
    : new (deps.WebSocket ?? (WebSocket as unknown as new (url: string) => Socket))(
        `${ticket.url}?ticket=${encodeURIComponent(ticket.ticket)}`,
      );
  const room = new RoomConnection(ws, deps);
  return new Promise((resolve, reject) => {
    ws.onmessage = (event) => {
      let msg: RtServerMessage;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      room.handle(msg);
      if (msg.t === "welcome") resolve(room);
    };
    ws.onclose = ({ code, reason }) => {
      if (room.connected) room.closed(code, reason);
      else reject(deps.error(CLOSE_ERRORS[code] ?? "internal", reason || "Couldn't join the room", { closeCode: code }));
    };
  });
}

/** Queues for a match, polls until the matcher puts the player in a room, and joins it. */
export async function matchmake(options: MatchmakeOptions, deps: RoomDeps): Promise<Room> {
  const { signal, ...request } = options;
  const aborted = () => signal?.reason ?? deps.error("conflict", "Matchmaking was cancelled");
  if (signal?.aborted) throw aborted();
  const { requestId } = await deps.call("multiplayer.matchmake", request);
  let ticket: MultiplayerTicket | undefined;
  try {
    while (!ticket) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(done, 1500);
        signal?.addEventListener("abort", done, { once: true });
        function done() {
          clearTimeout(timer);
          signal?.removeEventListener("abort", done);
          if (signal?.aborted) reject(aborted());
          else resolve();
        }
      });
      const status = await deps.call("multiplayer.matchmakeStatus", { requestId });
      if (status.status === "matched") ticket = status.ticket;
      else if (status.status !== "queued") {
        throw deps.error("not_found", status.status === "timeout" ? "No match found in time" : "Matchmaking was cancelled");
      }
    }
  } finally {
    if (!ticket) deps.call("multiplayer.matchmakeCancel", { requestId }).catch(() => {});
  }
  return connect(ticket, deps);
}

/** Mock mode: a one-player room that answers like the realtime server. */
function loopback(ticket: string): Socket {
  const t = JSON.parse(ticket) as {
    you: string;
    name: string;
    avatar: string | null;
    mode: string;
    room?: string;
    create?: { capacity?: number; visibility?: "public" | "private"; metadata?: Record<string, unknown> };
  };
  const code = t.room?.toUpperCase() || Math.random().toString(36).slice(2, 8).toUpperCase();
  const info: RoomInfo = {
    code,
    mode: t.mode,
    capacity: t.create?.capacity ?? 8,
    visibility: t.create?.visibility ?? "private",
    locked: false,
    metadata: t.create?.metadata ?? {},
    hostId: t.you,
    inviteUrl: `https://infinitegamer.net/play?game=mock-game&room=${code}`,
  };
  const state: Record<string, RoomStateEntry> = {};
  let open = true;
  const reply = (...frames: RtServerMessage[]) =>
    setTimeout(() => {
      for (const f of frames) if (open) ws.onmessage?.({ data: JSON.stringify(f) });
    });
  const ws: Socket = {
    onmessage: null,
    onclose: null,
    send(raw) {
      const m = JSON.parse(raw) as RtClientMessage;
      const ref = "ref" in m ? m.ref : undefined;
      const ack: RtServerMessage[] = ref ? [{ t: "ack", ref }] : [];
      switch (m.t) {
        case "send": {
          const echo: RtServerMessage[] = m.to?.includes(t.you) ? [{ t: "msg", from: t.you, data: m.data ?? null }] : [];
          return reply(...echo, ...ack);
        }
        case "state.set":
        case "state.delete": {
          const current = state[m.key]?.version ?? 0;
          if (m.ifVersion !== undefined && m.ifVersion !== current) {
            return reply({ t: "error", ref: m.ref, code: "conflict", message: `"${m.key}" is at version ${current}`, details: { version: current } });
          }
          const set = m.t === "state.set";
          const version = set ? current + 1 : 0;
          const value = m.t === "state.set" ? (m.value ?? null) : null;
          if (set) state[m.key] = { value, version };
          else delete state[m.key];
          const change: RtServerMessage = set
            ? { t: "state", key: m.key, value, version, by: t.you }
            : { t: "state", key: m.key, value, version, by: t.you, deleted: true };
          return reply(change, ...(ref ? [{ t: "ack", ref, version } as const] : []));
        }
        case "room.update": {
          const { t: _, ref: __, ...changes } = m;
          Object.assign(info, changes);
          return reply({ t: "room", room: { ...info } }, ...ack);
        }
        case "kick":
        case "host.transfer":
          return reply({ t: "error", ref: m.ref, code: "not_found", message: "That player isn't in the room" });
        case "ping":
          return reply({ t: "pong", ref: m.ref, now: Date.now() });
        case "leave":
          return ws.close(1000);
      }
    },
    close(code = 1000, reason = "") {
      if (!open) return;
      open = false;
      setTimeout(() => ws.onclose?.({ code, reason }));
    },
  };
  reply({
    t: "welcome",
    protocol: 1,
    you: t.you,
    room: { ...info },
    players: [{ id: t.you, displayName: t.name, avatarUrl: t.avatar, joinedAt: Date.now() }],
    state: {},
  });
  return ws;
}
