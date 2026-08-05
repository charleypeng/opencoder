// L1 tests for the i18n infrastructure (TASK-M9-01): key-set equality
// between the en and zh-CN resources, system-locale detection with the
// localStorage override taking precedence, setLang persistence + signal
// updates, and useT returning translated strings (incl. plural rules).

import { afterEach, describe, expect, it } from "vitest";
import { detectLanguage, LANG_STORAGE_KEY, language, setLang, useT } from "./index.js";
import en from "./en.json";
import zhCN from "./zh-CN.json";

/** Flattens a resource object into "ns.key" paths. */
function flattenKeys(resource: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(resource).flatMap(([key, value]) =>
    typeof value === "string"
      ? [`${prefix}${key}`]
      : flattenKeys(value as Record<string, unknown>, `${prefix}${key}.`),
  );
}

afterEach(() => {
  setLang("en");
  localStorage.removeItem(LANG_STORAGE_KEY);
  Object.defineProperty(navigator, "language", { value: "en-US", configurable: true });
});

describe("resource key sets", () => {
  it("en and zh-CN expose identical key sets", () => {
    expect(flattenKeys(en).sort()).toEqual(flattenKeys(zhCN).sort());
  });
});

describe("detectLanguage", () => {
  it("falls back to the system locale when no override is stored", () => {
    localStorage.removeItem(LANG_STORAGE_KEY);
    expect(detectLanguage()).toBe("en");
  });

  it("maps a zh system locale to zh-CN", () => {
    localStorage.removeItem(LANG_STORAGE_KEY);
    Object.defineProperty(navigator, "language", { value: "zh-CN", configurable: true });
    expect(detectLanguage()).toBe("zh-CN");
    Object.defineProperty(navigator, "language", { value: "zh-Hans", configurable: true });
    expect(detectLanguage()).toBe("zh-CN");
  });

  it("gives the stored override precedence over the system locale", () => {
    Object.defineProperty(navigator, "language", { value: "zh-CN", configurable: true });
    localStorage.setItem(LANG_STORAGE_KEY, "en");
    expect(detectLanguage()).toBe("en");
  });

  it("ignores malformed overrides", () => {
    localStorage.setItem(LANG_STORAGE_KEY, "fr");
    expect(detectLanguage()).toBe("en");
  });
});

describe("setLang", () => {
  it("updates the language signal and persists the override", () => {
    setLang("zh-CN");
    expect(language()).toBe("zh-CN");
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe("zh-CN");
    setLang("en");
    expect(language()).toBe("en");
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe("en");
  });
});

describe("useT", () => {
  it("returns English strings by default", () => {
    const t = useT();
    expect(t("common:cancel")).toBe("Cancel");
    expect(t("common:retry")).toBe("Retry");
  });

  it("returns Chinese strings after switching the language", () => {
    setLang("zh-CN");
    const t = useT();
    expect(t("common:cancel")).toBe("取消");
    expect(t("settings:language")).toBe("语言");
  });

  it("resolves bare keys against the default common namespace", () => {
    const t = useT();
    expect(t("cancel")).toBe("Cancel");
  });

  it("applies interpolation", () => {
    const t = useT();
    expect(t("permissions:waiting", { count: 1, total: 3 })).toBe("1 of 3 waiting");
  });

  it("applies English plural rules", () => {
    const t = useT();
    expect(t("messages:newMessages", { count: 1 })).toBe("1 new message");
    expect(t("messages:newMessages", { count: 2 })).toBe("2 new messages");
  });
});
