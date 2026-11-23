import type {
  BRIDGE_VERSION as CONTRACT_BRIDGE_VERSION,
  BridgeMethod,
  BridgeNotification,
} from "@infinitegamer/protocol/bridge";

/*
 * Runtime copies of the bridge constants in `@infinitegamer/protocol/bridge`. That module builds Zod
 * schemas at import time, and Zod would triple the size of the game bundle, so the SDK mirrors the few
 * values it needs and `test/protocol-sync.test.ts` fails if they drift.
 */

export const BRIDGE_VERSION: typeof CONTRACT_BRIDGE_VERSION = 1;
export const BRIDGE_TIMEOUT_MS = 10_000;
export const BRIDGE_URL_PARAMS = {
  shellOrigin: "ig_shell",
  locale: "ig_locale",
  muted: "ig_muted",
} as const;
export const BRIDGE_INTERACTIVE_METHODS: readonly BridgeMethod[] = [
  "feedback.open",
  "ads.show",
  "payments.purchase",
  "clips.share",
  "player.signIn",
  "leaderboards.show",
  "achievements.show",
];
export const TRUSTED_SHELL_ORIGINS: readonly string[] = ["https://infinitegamer.net"];
export const ANALYTICS_EVENT_NAME = /^[a-z][a-z0-9_]*$/;

export type Envelope =
  | { ig: number; kind: "request"; id: string; method: BridgeMethod; params: unknown }
  | { ig: number; kind: "response"; id: string; ok: true; result: unknown }
  | {
      ig: number;
      kind: "response";
      id: string;
      ok: false;
      error: { code: string; message: string };
    }
  | { ig: number; kind: "event"; event: string; data: unknown }
  | { ig: number; kind: "notify"; method: BridgeNotification; params: unknown };

export function isEnvelope(data: unknown): data is Envelope {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (typeof d.ig !== "number") return false;
  switch (d.kind) {
    case "response":
      return typeof d.id === "string" && typeof d.ok === "boolean";
    case "event":
      return typeof d.event === "string";
    case "request":
      return typeof d.id === "string" && typeof d.method === "string";
    case "notify":
      return typeof d.method === "string";
    default:
      return false;
  }
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname;
    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "127.0.0.1" ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
}
