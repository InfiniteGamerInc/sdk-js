/** Error codes returned by the API and the SDK bridge. Documented on the error codes reference page. */
export const ERROR_CODES = {
  bad_request: "The request was malformed or failed validation.",
  unauthenticated: "Sign in first.",
  forbidden: "You don't have access to this resource.",
  not_found: "The resource doesn't exist.",
  conflict: "The resource changed or already exists.",
  rate_limited: "Too many requests. Slow down and retry.",
  payload_too_large: "The request or value is over its size limit.",
  quota_exceeded: "A per-game or per-player quota was reached.",
  not_in_shell: "The SDK isn't running inside the Infinite Gamer shell (mock mode handles this).",
  bridge_timeout: "The shell didn't answer in time.",
  bridge_version_mismatch: "The SDK and the shell speak different bridge versions.",
  unknown_leaderboard: "No leaderboard with that id is declared for this game.",
  unknown_achievement: "No achievement with that id is declared for this game.",
  feature_unavailable: "This feature isn't available yet or is turned off for this game.",
  internal: "Something went wrong on our side.",
  reauthentication_required: "This action needs a recent sign-in. Sign in again, then retry.",
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export class IgError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? ERROR_CODES[code]);
    this.name = "IgError";
    this.code = code;
    this.details = details;
  }
}
