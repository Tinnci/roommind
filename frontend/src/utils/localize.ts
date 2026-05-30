import en from "../locales/en.json";
import de from "../locales/de.json";
import zhHans from "../locales/zh-Hans.json";

export type TranslationKey = keyof typeof en;

const translations: Record<string, Record<string, string>> = {
  en,
  de,
  "zh-Hans": zhHans,
  zh: zhHans,
};
const fallbackTranslations: Record<string, string> = en;

/**
 * Look up a translation key for the given language.
 * Falls back to English if the key is missing in the target language.
 * Supports simple {placeholder} interpolation.
 */
export function localize(
  key: TranslationKey,
  language: string,
  params?: Record<string, string | number>,
): string {
  const baseLanguage = language.split("-")[0] ?? "en";
  const lang = translations[language] ?? translations[baseLanguage] ?? fallbackTranslations;
  let result = lang[key] ?? fallbackTranslations[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      result = result.replaceAll(`{${k}}`, String(v));
    }
  }

  return result;
}
