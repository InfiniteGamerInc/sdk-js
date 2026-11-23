import type { BridgeMethod, BridgeNotification, BridgeParams, BridgeResult } from "@infinitegamer/protocol/bridge";
import { STAGE_LIMITS } from "@infinitegamer/protocol/limits";
import type { IgClient } from "./client.ts";
import type {
  Stage,
  StageEvents,
  StageMockOptions,
  StageRole,
  StageSample,
  StageSnapshot,
  StageStatus,
  StageTurnResult,
  StageWatchOptions,
} from "./types.ts";

/**
 * Lazy stage client (`IG.stage`). The shell holds the stage connection; this chunk turns its bridge events into a
 * {@link Stage} and, in mock mode, simulates a line, a ready check, and turns so a developer can test alone.
 */

/** What the core gives the stage chunk. */
export interface StageDeps {
  call<M extends BridgeMethod>(method: M, params: BridgeParams<M>): Promise<BridgeResult<M>>;
  error(code: string, message: string, details?: unknown): Error;
  ig: IgClient;
  send(method: BridgeNotification, params: object): void;
}

interface Backend {
  watch(): Promise<StageStatus>;
  join(): Promise<{ role: StageRole; position: number | null }>;
  leave(): Promise<unknown>;
  ready(accept: boolean): Promise<unknown>;
  end(result?: StageTurnResult): Promise<unknown>;
  update(state: unknown): void;
}

type Emit = (event: keyof StageEvents, data: unknown) => void;
type Listener = (data: never) => void;

const EVENTS = ["role", "position", "readyCheck", "turnStart", "turnEnd", "state", "viewers"] as const;
const BUFFER = 32;
const MOCK_RULES = { maxTurnSeconds: 60, readyCheckSeconds: 10, idleTimeoutSeconds: 20, maxQueueLength: 200, allowGuests: true };

class StageClient<S> implements Stage<S> {
  private s: StageStatus;
  private offset = 0;
  private buffer: StageSnapshot<S>[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();
  private pending: { state: S } | null = null;
  private lastSent = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  backend!: Backend;

  constructor(
    private readonly deps: StageDeps,
    private readonly me: string,
  ) {
    this.s = {
      role: "viewer",
      position: null,
      waitSeconds: null,
      queueLength: 0,
      viewers: 0,
      current: null,
      lastTurn: null,
      latest: null,
      readyCheck: null,
      rules: MOCK_RULES,
      now: Date.now(),
    };
  }

  get role() {
    return this.s.role;
  }
  get position() {
    return this.s.position;
  }
  get waitSeconds() {
    return this.s.waitSeconds;
  }
  get queueLength() {
    return this.s.queueLength;
  }
  get viewers() {
    return this.s.viewers;
  }
  get current() {
    return this.s.current;
  }
  get lastTurn() {
    return this.s.lastTurn;
  }
  get readyCheck() {
    return this.s.readyCheck;
  }
  get rules() {
    return this.s.rules;
  }

  status(): StageStatus {
    return { ...this.s, now: this.serverNow() };
  }

  apply(status: StageStatus): void {
    this.s = { ...status };
    this.offset = status.now - Date.now();
    this.buffer = status.latest ? [status.latest as StageSnapshot<S>] : [];
  }

  async join() {
    const res = await this.backend.join();
    this.handle("role", res);
    return res;
  }

  async leave() {
    await this.backend.leave();
  }

  async ready(accept = true) {
    await this.backend.ready(accept);
  }

  update(state: S): void {
    if (this.s.role !== "player") return;
    const json = JSON.stringify(state);
    if (json === undefined) throw this.deps.error("bad_request", "Stage state must be JSON");
    if (new TextEncoder().encode(json).length > STAGE_LIMITS.stateMaxBytes) {
      throw this.deps.error("payload_too_large", `Stage state is limited to ${STAGE_LIMITS.stateMaxBytes} bytes of JSON`);
    }
    this.pending = { state };
    const wait = this.lastSent + 1000 / STAGE_LIMITS.updatesPerSecond - Date.now();
    if (wait <= 0) this.flush();
    else this.timer ??= setTimeout(() => this.flush(), wait);
  }

  async endTurn(result?: StageTurnResult) {
    this.flush();
    await this.backend.end(result);
  }

  latest(): StageSnapshot<S> | null {
    return this.s.latest as StageSnapshot<S> | null;
  }

  sample(delayMs = 100): StageSample<S> | null {
    const b = this.buffer;
    if (b.length === 0) return null;
    const target = this.serverNow() - delayMs;
    let i = b.length - 1;
    while (i > 0 && b[i]!.at > target) i--;
    const from = b[i]!;
    const to = b[Math.min(i + 1, b.length - 1)]!;
    const span = to.at - from.at;
    return { from, to, t: span > 0 ? Math.min(1, Math.max(0, (target - from.at) / span)) : 1 };
  }

  serverNow(): number {
    return Date.now() + this.offset;
  }

  on<E extends keyof StageEvents<S>>(event: E, listener: (data: StageEvents<S>[E]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener as Listener);
    return () => void set.delete(listener as Listener);
  }

  /** A stage event from the shell (or the mock): update the status, then tell listeners. */
  readonly handle = (event: keyof StageEvents, raw: unknown): void => {
    const s = this.s;
    const d = { ...(raw as Record<string, never>) } as Record<string, unknown>;
    switch (event) {
      case "role":
        s.role = d.role as StageRole;
        s.position = (d.position as number | null) ?? null;
        if (s.role !== "waiting" || s.position === null) s.waitSeconds = null;
        if (s.role !== "waiting") s.readyCheck = null;
        break;
      case "position":
        Object.assign(s, d);
        break;
      case "readyCheck":
        s.readyCheck = d as StageStatus["readyCheck"];
        s.position = null;
        break;
      case "turnStart": {
        const t = d as unknown as StageEvents["turnStart"];
        s.current = { player: t.player, turn: t.turn, phase: "playing", startedAt: t.startedAt, endsAt: t.endsAt };
        s.latest = null;
        this.buffer = [];
        d.you = t.player.id === this.me;
        if (d.you) s.readyCheck = null;
        break;
      }
      case "turnEnd": {
        const t = d as unknown as StageEvents["turnEnd"];
        d.you = t.player.id === this.me;
        if (t.reason !== "declined") {
          s.lastTurn = { player: t.player, turn: t.turn, reason: t.reason, result: t.result, endedAt: t.endedAt };
          s.latest = null;
          this.buffer = [];
        }
        if (s.current?.player.id === t.player.id) s.current = null;
        if (d.you) {
          clearTimeout(this.timer);
          this.timer = undefined;
          this.pending = null;
        }
        break;
      }
      case "state":
        s.latest = d as unknown as StageSnapshot;
        this.buffer.push(d as unknown as StageSnapshot<S>);
        if (this.buffer.length > BUFFER) this.buffer.shift();
        break;
      case "viewers":
        s.viewers = d.count as number;
        s.queueLength = d.queueLength as number;
    }
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try {
        listener(d as never);
      } catch (err) {
        console.error(`[IG] A stage "${event}" listener threw`, err);
      }
    }
  };

  private flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const p = this.pending;
    if (!p || this.s.role !== "player") return;
    this.pending = null;
    this.lastSent = Date.now();
    this.s.latest = { state: p.state, at: this.serverNow(), seq: (this.s.latest?.seq ?? 0) + 1 };
    this.backend.update(p.state);
  }
}

function shellBackend(deps: StageDeps): Backend {
  return {
    watch: () => deps.call("stage.watch", {}),
    join: () => deps.call("stage.join", {}),
    leave: () => deps.call("stage.leave", {}),
    ready: (accept) => deps.call("stage.ready", { accept }),
    end: (result) => deps.call("stage.endTurn", result ? { result } : {}),
    update: (state) => deps.send("stage.update", { state }),
  };
}

/**
 * Mock mode: simulated players take turns (replaying the states you sent in your last turn, so you can check your
 * viewer mode), you get in line behind them, answer a ready check, and play a turn with the usual limits.
 */
function mockBackend(me: string, options: StageMockOptions, emit: Emit, error: StageDeps["error"]): Backend {
  const o = { otherTurnSeconds: 5, playersAhead: 1, ...MOCK_RULES, ...options };
  const rules = { ...MOCK_RULES, maxTurnSeconds: o.maxTurnSeconds, readyCheckSeconds: o.readyCheckSeconds, idleTimeoutSeconds: o.idleTimeoutSeconds };
  let turn = 0;
  let seq = 0;
  let ahead = 0;
  let role: StageRole = "viewer";
  let current: StageStatus["current"] = null;
  let recording: Array<{ state: unknown; dt: number }> = [];
  let taping: typeof recording = [];
  let timers: ReturnType<typeof setTimeout>[] = [];
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
  const position = () => ahead + 1;
  const wait = () => Math.round(position() * o.otherTurnSeconds);
  const setRole = (r: StageRole, pos: number | null = null) => {
    role = r;
    emit("role", { role: r, position: pos });
  };

  const otherTurn = () => {
    const now = Date.now();
    const player = { id: `mock-${turn % 3}`, name: `Mock player ${(turn % 3) + 1}` };
    const tape = recording;
    const length = Math.max(o.otherTurnSeconds * 1000, (tape[tape.length - 1]?.dt ?? 0) + 500);
    current = { player, turn: ++turn, phase: "playing", startedAt: now, endsAt: now + length };
    emit("turnStart", { player, turn, startedAt: now, endsAt: now + length });
    for (const { state, dt } of tape) later(dt, () => emit("state", { state, at: Date.now(), seq: ++seq }));
    later(length, () => {
      emit("turnEnd", { player, turn, reason: "ended", result: { score: 100 * turn }, endedAt: Date.now() });
      current = null;
      next();
    });
  };

  const next = () => {
    if (role === "waiting" && ahead === 0) {
      const expiresAt = Date.now() + o.readyCheckSeconds * 1000;
      current = { player: { id: me, name: null }, turn: turn + 1, phase: "ready", startedAt: Date.now(), endsAt: expiresAt };
      emit("readyCheck", { expiresAt });
      deadline = setTimeout(() => endMine("declined"), o.readyCheckSeconds * 1000);
      return;
    }
    if (role === "waiting") {
      ahead--;
      emit("position", { position: position(), queueLength: position(), waitSeconds: wait() });
    }
    later(800, otherTurn);
  };

  const myTurn = () => {
    clearTimeout(deadline);
    const now = Date.now();
    current = { player: { id: me, name: null }, turn: ++turn, phase: "playing", startedAt: now, endsAt: now + o.maxTurnSeconds * 1000 };
    taping = [];
    emit("turnStart", { player: current.player, turn, startedAt: now, endsAt: current.endsAt });
    setRole("player");
    deadline = setTimeout(() => endMine("timeout"), o.maxTurnSeconds * 1000);
    touch();
  };

  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => endMine("idle"), o.idleTimeoutSeconds * 1000);
  };

  const endMine = (reason: StageEvents["turnEnd"]["reason"], result: StageTurnResult | null = null) => {
    clearTimeout(deadline);
    clearTimeout(idle);
    const player = current?.player ?? { id: me, name: null };
    if (role === "player") recording = taping;
    emit("turnEnd", { player, turn: current?.turn ?? turn, reason, result, endedAt: Date.now() });
    current = null;
    setRole("viewer");
    later(800, otherTurn);
  };

  return {
    watch: async () => {
      later(0, otherTurn);
      const now = Date.now();
      return {
        role,
        position: null,
        waitSeconds: null,
        queueLength: 0,
        viewers: 3,
        current: null,
        lastTurn: null,
        latest: null,
        readyCheck: null,
        rules,
        now,
      };
    },
    join: async () => {
      if (role !== "viewer") return { role, position: role === "waiting" ? position() : null };
      if (!current) {
        for (const t of timers) clearTimeout(t);
        timers = [];
        myTurn();
        return { role, position: null };
      }
      ahead = Math.max(0, o.playersAhead);
      setRole("waiting", position());
      emit("position", { position: position(), queueLength: position(), waitSeconds: wait() });
      return { role, position: position() };
    },
    leave: async () => {
      if (role === "player" || current?.phase === "ready") endMine(role === "player" ? "left" : "declined");
      else if (role === "waiting") setRole("viewer");
    },
    ready: async (accept) => {
      if (current?.phase !== "ready") throw error("conflict", "There's no ready check for you right now");
      if (accept) myTurn();
      else endMine("declined");
    },
    end: async (result) => {
      if (role !== "player") throw error("forbidden", "Only the player on stage can end the turn");
      endMine("ended", result ?? null);
    },
    update: (state) => {
      if (role !== "player" || !current) return;
      taping.push({ state, dt: Date.now() - current.startedAt });
      touch();
    },
  };
}

const stages = new WeakMap<StageDeps, Promise<StageClient<unknown>>>();

/** Starts watching the stage (once per client) and resolves with it. */
export function watch<S>(options: StageWatchOptions = {}, deps: StageDeps): Promise<Stage<S>> {
  let stage = stages.get(deps);
  if (!stage) {
    stage = (async () => {
      const ctx = await deps.ig.init();
      const client = new StageClient<unknown>(deps, ctx.player.id);
      client.backend = ctx.isMock ? mockBackend(ctx.player.id, options.mock ?? {}, client.handle, deps.error) : shellBackend(deps);
      if (!ctx.isMock) for (const e of EVENTS) deps.ig.on(`stage.${e}` as never, (data: unknown) => client.handle(e, data));
      client.apply(await client.backend.watch());
      return client;
    })();
    stages.set(deps, stage);
    stage.catch(() => stages.delete(deps));
  }
  return stage as Promise<Stage<S>>;
}
