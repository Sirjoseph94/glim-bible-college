import { describe, expect, it } from "vitest";
import {
  readThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  writeThemePreference,
} from "./theme";

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
}

const throwing = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("theme preference", () => {
  it("follows the device when nothing is stored", () => {
    expect(readThemePreference(memoryStorage())).toBe("system");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("keeps a pinned choice whatever the device says", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("reads back what was stored, and choosing system clears it", () => {
    const storage = memoryStorage();
    writeThemePreference(storage, "dark");
    expect(storage.items.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(readThemePreference(storage)).toBe("dark");
    writeThemePreference(storage, "system");
    expect(storage.items.has(THEME_STORAGE_KEY)).toBe(false);
  });

  it("ignores a stored value it doesn't recognise", () => {
    expect(readThemePreference(memoryStorage({ [THEME_STORAGE_KEY]: "sepia" }))).toBe("system");
  });

  it("falls back to system when storage is blocked, and writing doesn't throw", () => {
    expect(readThemePreference(throwing)).toBe("system");
    expect(readThemePreference(undefined)).toBe("system");
    expect(() => {
      writeThemePreference(throwing, "dark");
    }).not.toThrow();
  });
});
