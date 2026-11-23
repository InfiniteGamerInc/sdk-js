import type { BridgeMethod, BridgeNotification } from "@infinitegamer/protocol/bridge";
import { ERROR_CODES, IgError, type ErrorCode } from "@infinitegamer/protocol/errors";
import {
  BRIDGE_INTERACTIVE_METHODS,
  BRIDGE_VERSION,
  isEnvelope,
  type Envelope,
} from "./protocol.ts";

/** How the client reaches the platform: the shell over postMessage, or the local mock. */
export interface Backend {
  readonly isMock: boolean;
  request(method: BridgeMethod, params: unknown): Promise<unknown>;
  notify(method: BridgeNotification, params: unknown): void;
  destroy(): void;
}

export type EventSink = (event: string, data: unknown) => void;

interface Pending {
  resolve(value: unknown): void;
  reject(reason: IgError): void;
  timers: Array<ReturnType<typeof setTimeout>>;
}

export interface RequestOptions {
  /** `0` waits forever. */
  timeoutMs?: number;
  /** Re-post the same request (same id) on this interval until it's answered. Used for the handshake. */
  retryEveryMs?: number;
}

export function toIgError(error: { code?: unknown; message?: unknown } | undefined): IgError {
  const code = typeof error?.code === "string" ? error.code : "internal";
  const message = typeof error?.message === "string" ? error.message : undefined;
  if (code in ERROR_CODES) return new IgError(code as ErrorCode, message);
  return new IgError("internal", message, { code });
}

function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

/** Talks to the shell in `window.parent`. Only ever posts to, and listens to, the one trusted shell origin. */
export class BridgeTransport implements Backend {
  readonly isMock = false;
  private readonly pending = new Map<string, Pending>();
  private readonly prefix = randomId();
  private seq = 0;
  private destroyed = false;

  constructor(
    private readonly win: Window,
    private readonly shellOrigin: string,
    private readonly onEvent: EventSink,
    private readonly timeoutMs: number,
  ) {
    win.addEventListener("message", this.onMessage);
  }

  request(method: BridgeMethod, params: unknown, options: RequestOptions = {}): Promise<unknown> {
    if (this.destroyed)
      return Promise.reject(new IgError("not_in_shell", "The SDK client was destroyed"));
    const id = `${this.prefix}-${++this.seq}`;
    const envelope: Envelope = { ig: BRIDGE_VERSION, kind: "request", id, method, params };
    const timeoutMs =
      options.timeoutMs ?? (BRIDGE_INTERACTIVE_METHODS.includes(method) ? 0 : this.timeoutMs);
    return new Promise<unknown>((resolve, reject) => {
      const pending: Pending = { resolve, reject, timers: [] };
      this.pending.set(id, pending);
      if (timeoutMs > 0) {
        pending.timers.push(
          setTimeout(
            () =>
              this.settle(id)?.reject(
                new IgError(
                  "bridge_timeout",
                  `The shell didn't answer ${method} in ${timeoutMs} ms`,
                ),
              ),
            timeoutMs,
          ),
        );
      }
      if (options.retryEveryMs) {
        const retry = () => {
          if (!this.pending.has(id)) return;
          this.post(envelope);
          pending.timers.push(setTimeout(retry, options.retryEveryMs));
        };
        pending.timers.push(setTimeout(retry, options.retryEveryMs));
      }
      try {
        this.post(envelope);
      } catch (err) {
        this.settle(id);
        reject(new IgError("bad_request", `Couldn't send ${method}: ${String(err)}`));
      }
    });
  }

  notify(method: BridgeNotification, params: unknown): void {
    if (this.destroyed) return;
    try {
      this.post({ ig: BRIDGE_VERSION, kind: "notify", method, params });
    } catch (err) {
      console.warn(`[IG] Couldn't send ${method}`, err);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.win.removeEventListener("message", this.onMessage);
    for (const id of [...this.pending.keys()]) {
      this.settle(id)?.reject(new IgError("not_in_shell", "The SDK client was destroyed"));
    }
  }

  private post(envelope: Envelope): void {
    this.win.parent.postMessage(envelope, this.shellOrigin);
  }

  private settle(id: string): Pending | undefined {
    const pending = this.pending.get(id);
    if (!pending) return undefined;
    this.pending.delete(id);
    for (const timer of pending.timers) clearTimeout(timer);
    return pending;
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (event.source !== this.win.parent || event.origin !== this.shellOrigin) return;
    const msg: unknown = event.data;
    if (!isEnvelope(msg)) return;
    if (msg.kind === "response") {
      const pending = this.settle(msg.id);
      if (!pending) return;
      if (msg.ok) pending.resolve(msg.result);
      else pending.reject(toIgError(msg.error));
    } else if (msg.kind === "event" && msg.ig === BRIDGE_VERSION) {
      this.onEvent(msg.event, msg.data);
    }
  };
}
