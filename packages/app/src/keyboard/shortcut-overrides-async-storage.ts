import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ShortcutOverrides } from "@/keyboard/keyboard-shortcuts";
import type { ShortcutOverrideStorage } from "@/keyboard/shortcut-override-store";
import { readValidatedJson } from "@/storage/validated-storage";
import { z } from "zod";

export const SHORTCUT_OVERRIDES_STORAGE_KEY = "@paseo:keyboard-shortcut-overrides";

export const ShortcutOverridesSchema = z.record(z.string(), z.string().nullable());

export async function readAsyncStorageShortcutOverrides(): Promise<ShortcutOverrides | null> {
  return readValidatedJson(AsyncStorage, SHORTCUT_OVERRIDES_STORAGE_KEY, ShortcutOverridesSchema);
}

export const asyncStorageShortcutOverrides: ShortcutOverrideStorage = {
  write: (serialized) => AsyncStorage.setItem(SHORTCUT_OVERRIDES_STORAGE_KEY, serialized),
  remove: () => AsyncStorage.removeItem(SHORTCUT_OVERRIDES_STORAGE_KEY),
};
