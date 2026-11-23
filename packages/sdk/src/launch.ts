import { isLocale, type Locale } from "@infinitegamer/protocol/locales";
import { BRIDGE_URL_PARAMS } from "./protocol.ts";

/** What the shell put in the iframe URL. Read once when the client is created, before the game can rewrite the URL. */
export interface LaunchParams {
  shellOrigin: string | null;
  locale: Locale | null;
  muted: boolean | null;
}

export function readLaunchParams(href: string | undefined): LaunchParams {
  const empty: LaunchParams = { shellOrigin: null, locale: null, muted: null };
  if (!href) return empty;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return empty;
  }
  const fromHash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const get = (name: string) => url.searchParams.get(name) ?? fromHash.get(name);

  let shellOrigin: string | null = null;
  const rawShell = get(BRIDGE_URL_PARAMS.shellOrigin);
  if (rawShell) {
    try {
      const origin = new URL(rawShell).origin;
      if (origin !== "null") shellOrigin = origin;
    } catch {
      // Not a URL: treated as no shell.
    }
  }
  const rawLocale = get(BRIDGE_URL_PARAMS.locale);
  const rawMuted = get(BRIDGE_URL_PARAMS.muted);
  return {
    shellOrigin,
    locale: rawLocale && isLocale(rawLocale) ? rawLocale : null,
    muted: rawMuted === null ? null : rawMuted === "1" || rawMuted === "true",
  };
}
