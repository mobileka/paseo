import { resolvePaseoHome } from "@getpaseo/server";

import { createHotkeysConfigStore, type HotkeysConfigStore } from "./hotkeys-config.js";

let hotkeysConfigStore: HotkeysConfigStore | null = null;

export function getHotkeysConfigStore(): HotkeysConfigStore {
  hotkeysConfigStore ??= createHotkeysConfigStore({
    paseoHome: resolvePaseoHome(process.env),
  });
  return hotkeysConfigStore;
}
