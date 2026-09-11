import { beforeEach, describe, expect, it, vi } from "vitest";

const { asyncStorage } = vi.hoisted(() => ({
  asyncStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: asyncStorage,
}));

import { loadShortcutOverrides, shortcutOverridesStorage } from "./shortcut-overrides-storage";

describe("async storage shortcut overrides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asyncStorage.getItem.mockResolvedValue(null);
  });

  it("loads an empty map when nothing is stored", async () => {
    await expect(loadShortcutOverrides()).resolves.toEqual({});
  });

  it("parses stored overrides", async () => {
    asyncStorage.getItem.mockResolvedValue(JSON.stringify({ "workspace-new": "Cmd+N" }));

    await expect(loadShortcutOverrides()).resolves.toEqual({ "workspace-new": "Cmd+N" });
  });

  it("falls back to an empty map for invalid stored values", async () => {
    asyncStorage.getItem.mockResolvedValue("not json");

    await expect(loadShortcutOverrides()).resolves.toEqual({});
    expect(asyncStorage.removeItem).toHaveBeenCalled();
  });

  it("writes and removes through AsyncStorage", async () => {
    await shortcutOverridesStorage.write(JSON.stringify({ "workspace-new": "Cmd+N" }));
    await shortcutOverridesStorage.remove();

    expect(asyncStorage.setItem).toHaveBeenCalledWith(
      "@paseo:keyboard-shortcut-overrides",
      JSON.stringify({ "workspace-new": "Cmd+N" }),
    );
    expect(asyncStorage.removeItem).toHaveBeenCalledWith("@paseo:keyboard-shortcut-overrides");
  });
});
