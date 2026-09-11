import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import type { ShortcutOverrides } from "@/keyboard/keyboard-shortcuts";
import type { ShortcutOverrideStorage } from "@/keyboard/shortcut-override-store";
import { readAsyncStorageShortcutOverrides } from "@/keyboard/shortcut-overrides-async-storage";

interface HotkeysConfig {
  overrides: ShortcutOverrides;
  exists: boolean;
}

export async function loadShortcutOverrides(): Promise<ShortcutOverrides> {
  const config = await invokeDesktopCommand<HotkeysConfig>("get_hotkeys");
  if (config.exists) {
    return config.overrides;
  }
  return migrateLegacyOverrides(config.overrides);
}

/**
 * The file only exists once a write has happened, so `exists: false` means
 * this user has never written overrides: adopt whatever still lives in
 * AsyncStorage and publish it to the file. Every later load sees
 * `exists: true`, so the migration fires at most once.
 */
async function migrateLegacyOverrides(empty: ShortcutOverrides): Promise<ShortcutOverrides> {
  const legacy = await readAsyncStorageShortcutOverrides();
  if (!legacy || Object.keys(legacy).length === 0) {
    return empty;
  }
  await invokeDesktopCommand("set_hotkeys", { overrides: legacy });
  return legacy;
}

export const shortcutOverridesStorage: ShortcutOverrideStorage = {
  write: async (serialized) => {
    await invokeDesktopCommand("set_hotkeys", { overrides: JSON.parse(serialized) });
  },
  remove: () => invokeDesktopCommand("set_hotkeys", { overrides: {} }),
};
