/**
 * The platform's UI locales: English (the source) plus the same 49 locales the Golf iOS app ships.
 * Catalogs live in `l10n/<locale>.json`.
 */
export const SOURCE_LOCALE = "en" as const;

export const LOCALES = [
  "en",
  "ar",
  "bn",
  "ca",
  "cs",
  "da",
  "de",
  "el",
  "en-AU",
  "en-CA",
  "en-GB",
  "es",
  "es-MX",
  "fi",
  "fr",
  "fr-CA",
  "gu",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "kn",
  "ko",
  "ml",
  "mr",
  "ms",
  "nb",
  "nl",
  "or",
  "pa",
  "pl",
  "pt-BR",
  "pt-PT",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "ta",
  "te",
  "th",
  "tr",
  "uk",
  "ur",
  "vi",
  "zh-Hans",
  "zh-Hant",
] as const;

export type Locale = (typeof LOCALES)[number];

export const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(["ar", "he", "ur"]);

/** Native names, shown in the language picker. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English (US)",
  ar: "العربية",
  bn: "বাংলা",
  ca: "Català",
  cs: "Čeština",
  da: "Dansk",
  de: "Deutsch",
  el: "Ελληνικά",
  "en-AU": "English (Australia)",
  "en-CA": "English (Canada)",
  "en-GB": "English (UK)",
  es: "Español",
  "es-MX": "Español (México)",
  fi: "Suomi",
  fr: "Français",
  "fr-CA": "Français (Canada)",
  gu: "ગુજરાતી",
  he: "עברית",
  hi: "हिन्दी",
  hr: "Hrvatski",
  hu: "Magyar",
  id: "Bahasa Indonesia",
  it: "Italiano",
  ja: "日本語",
  kn: "ಕನ್ನಡ",
  ko: "한국어",
  ml: "മലയാളം",
  mr: "मराठी",
  ms: "Bahasa Melayu",
  nb: "Norsk bokmål",
  nl: "Nederlands",
  or: "ଓଡ଼ିଆ",
  pa: "ਪੰਜਾਬੀ",
  pl: "Polski",
  "pt-BR": "Português (Brasil)",
  "pt-PT": "Português (Portugal)",
  ro: "Română",
  ru: "Русский",
  sk: "Slovenčina",
  sl: "Slovenščina",
  sv: "Svenska",
  ta: "தமிழ்",
  te: "తెలుగు",
  th: "ไทย",
  tr: "Türkçe",
  uk: "Українська",
  ur: "اردو",
  vi: "Tiếng Việt",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}

/** URL prefix for a locale: English is unprefixed, others are lowercase (`/pt-br/`, `/zh-hans/`). */
export function localeToPathSegment(locale: Locale): string {
  return locale === SOURCE_LOCALE ? "" : locale.toLowerCase();
}

const BY_SEGMENT = new Map<string, Locale>(
  LOCALES.filter((l) => l !== SOURCE_LOCALE).map((l) => [l.toLowerCase(), l]),
);

export function pathSegmentToLocale(segment: string): Locale | undefined {
  return BY_SEGMENT.get(segment.toLowerCase());
}

/** BCP 47 tag for `hreflang` and `<html lang>`. */
export function localeToBcp47(locale: Locale): string {
  return locale;
}

/**
 * Picks the best supported locale for an Accept-Language header or navigator.languages list.
 * Exact match first, then language-only match (`pt` -> `pt-BR`, `zh-TW` -> `zh-Hant`).
 */
export function negotiateLocale(preferred: readonly string[]): Locale {
  const aliases: Record<string, Locale> = {
    zh: "zh-Hans",
    "zh-cn": "zh-Hans",
    "zh-sg": "zh-Hans",
    "zh-tw": "zh-Hant",
    "zh-hk": "zh-Hant",
    "zh-mo": "zh-Hant",
    pt: "pt-BR",
    no: "nb",
    nn: "nb",
    iw: "he",
    in: "id",
  };
  for (const raw of preferred) {
    const tag = raw.trim().split(";")[0]?.trim();
    if (!tag) continue;
    const lower = tag.toLowerCase();
    const exact = LOCALES.find((l) => l.toLowerCase() === lower);
    if (exact) return exact;
    if (aliases[lower]) return aliases[lower];
    const lang = lower.split("-")[0] ?? "";
    if (aliases[lang]) return aliases[lang];
    const byLang = LOCALES.find((l) => l.toLowerCase() === lang);
    if (byLang) return byLang;
  }
  return SOURCE_LOCALE;
}

export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag ?? "", q: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter((p) => p.tag && !Number.isNaN(p.q))
    .sort((a, b) => b.q - a.q)
    .map((p) => p.tag);
}
