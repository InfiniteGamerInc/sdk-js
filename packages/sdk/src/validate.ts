import { IgError } from "@infinitegamer/protocol/errors";
import { SDK_LIMITS } from "@infinitegamer/protocol/limits";
import { ANALYTICS_EVENT_NAME } from "./protocol.ts";
import type { AnalyticsProps } from "./types.ts";

const encoder = /* @__PURE__ */ new TextEncoder();

export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

export function checkSaveKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > SDK_LIMITS.saveKeyMax) {
    throw new IgError(
      "bad_request",
      `Save keys are strings of 1 to ${SDK_LIMITS.saveKeyMax} characters`,
    );
  }
}

/** Normalizes a save value through JSON, so the mock and the shell store exactly what the server would. */
export function toJsonValue(value: unknown): { json: unknown; bytes: number } {
  if (value === undefined)
    throw new IgError("bad_request", "Save values can't be undefined; use storage.delete()");
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch (err) {
    throw new IgError("bad_request", "Save values must be JSON-serializable", {
      cause: String(err),
    });
  }
  if (text === undefined) throw new IgError("bad_request", "Save values must be JSON-serializable");
  const bytes = byteLength(text);
  if (bytes > SDK_LIMITS.saveValueMaxBytes) {
    throw new IgError(
      "payload_too_large",
      `Save values are limited to ${SDK_LIMITS.saveValueMaxBytes} bytes of JSON`,
      {
        bytes,
        limit: SDK_LIMITS.saveValueMaxBytes,
      },
    );
  }
  return { json: JSON.parse(text) as unknown, bytes };
}

export function checkId(
  kind: "leaderboard" | "achievement" | "product",
  id: unknown,
): asserts id is string {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) {
    throw new IgError("bad_request", `The ${kind} id must be a string of 1 to 64 characters`);
  }
}

export function checkInt(name: string, value: number | undefined, min: number, max: number): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new IgError("bad_request", `${name} must be a whole number from ${min} to ${max}`);
  }
}

/** Returns a reason the event would be rejected, or `null` when it's fine. */
export function analyticsProblem(name: unknown, props: AnalyticsProps | undefined): string | null {
  if (
    typeof name !== "string" ||
    name.length > SDK_LIMITS.analyticsEventNameMax ||
    !ANALYTICS_EVENT_NAME.test(name)
  ) {
    return `Event names are snake_case (a-z, 0-9, _), start with a letter, and are at most ${SDK_LIMITS.analyticsEventNameMax} characters`;
  }
  if (props === undefined) return null;
  if (typeof props !== "object" || props === null || Array.isArray(props))
    return "Event props must be a flat object";
  for (const value of Object.values(props)) {
    const t = typeof value;
    if (
      value !== null &&
      t !== "string" &&
      t !== "boolean" &&
      !(t === "number" && Number.isFinite(value))
    ) {
      return "Event prop values must be strings, finite numbers, booleans, or null";
    }
  }
  if (byteLength(JSON.stringify(props)) > SDK_LIMITS.analyticsPropsMaxBytes) {
    return `Event props are limited to ${SDK_LIMITS.analyticsPropsMaxBytes} bytes of JSON`;
  }
  return null;
}
