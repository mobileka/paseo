import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, asyncStorage } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  asyncStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock("@/desktop/electron/invoke", () => ({
  invokeDesktopCommand: invokeMock,
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: asyncStorage,
}));

import {
  loadShortcutOverrides,
  shortcutOverridesStorage,
} from "./shortcut-overrides-storage.electron";

describe("electron shortcut overrides storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asyncStorage.getItem.mockResolvedValue(null);
  });

  it("uses the file overrides when the file exists", async () => {
    invokeMock.mockResolvedValue({
      overrides: { "agent-new-cmd-shift-o-mac": "Cmd+Shift+O" },
      exists: true,
    });

    await expect(loadShortcutOverrides()).resolves.toEqual({
      "agent-new-cmd-shift-o-mac": "Cmd+Shift+O",
    });
    expect(invokeMock).toHaveBeenCalledWith("get_hotkeys");
    expect(asyncStorage.getItem).not.toHaveBeenCalled();
  });

  it("migrates non-empty AsyncStorage overrides into the file once", async () => {
    invokeMock.mockResolvedValue({ overrides: {}, exists: false });
    asyncStorage.getItem.mockResolvedValue(JSON.stringify({ "workspace-new": null }));

    await expect(loadShortcutOverrides()).resolves.toEqual({ "workspace-new": null });
    expect(invokeMock).toHaveBeenCalledWith("set_hotkeys", {
      overrides: { "workspace-new": null },
    });
  });

  it("does not create the file when there is nothing to migrate", async () => {
    invokeMock.mockResolvedValue({ overrides: {}, exists: false });

    await expect(loadShortcutOverrides()).resolves.toEqual({});
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalledWith("set_hotkeys", expect.anything());
  });

  it("ignores invalid legacy AsyncStorage values during migration", async () => {
    invokeMock.mockResolvedValue({ overrides: {}, exists: false });
    asyncStorage.getItem.mockResolvedValue("not json");

    await expect(loadShortcutOverrides()).resolves.toEqual({});
    expect(invokeMock).not.toHaveBeenCalledWith("set_hotkeys", expect.anything());
  });

  it("writes the parsed record to the file", async () => {
    invokeMock.mockResolvedValue({ overrides: {}, exists: true });

    await shortcutOverridesStorage.write(JSON.stringify({ "workspace-new": "Cmd+N" }));

    expect(invokeMock).toHaveBeenCalledWith("set_hotkeys", {
      overrides: { "workspace-new": "Cmd+N" },
    });
  });

  it("clears the file on remove", async () => {
    invokeMock.mockResolvedValue({ overrides: {}, exists: true });

    await shortcutOverridesStorage.remove();

    expect(invokeMock).toHaveBeenCalledWith("set_hotkeys", { overrides: {} });
  });
});
