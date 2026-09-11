import type { ShortcutOverrides } from "@/keyboard/keyboard-shortcuts";
import type { ShortcutOverrideStorage } from "@/keyboard/shortcut-override-store";
import {
  asyncStorageShortcutOverrides,
  readAsyncStorageShortcutOverrides,
} from "@/keyboard/shortcut-overrides-async-storage";

export async function loadShortcutOverrides(): Promise<ShortcutOverrides> {
  return (await readAsyncStorageShortcutOverrides()) ?? {};
}

export const shortcutOverridesStorage: ShortcutOverrideStorage = asyncStorageShortcutOverrides;
