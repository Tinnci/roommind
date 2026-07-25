import { describe, expect, test } from "bun:test";
import de from "../locales/de.json";
import en from "../locales/en.json";
import zhHans from "../locales/zh-Hans.json";
import { localize } from "./localize";

const localeEntries = [
  ["de", de],
  ["zh-Hans", zhHans],
] as const;

describe("localize", () => {
  test("keeps supported locale key sets aligned with English", () => {
    const englishKeys = Object.keys(en).sort();

    for (const [locale, messages] of localeEntries) {
      expect(Object.keys(messages).sort(), locale).toEqual(englishKeys);
    }
  });

  test("falls back by base language and interpolates placeholders", () => {
    expect(localize("panel.stat.windows", "zh-Hans-CN", { count: 3 })).toContain("3");
  });

  test("falls back to English for unsupported languages", () => {
    expect(localize("panel.title", "fr")).toBe(en["panel.title"]);
  });
});
