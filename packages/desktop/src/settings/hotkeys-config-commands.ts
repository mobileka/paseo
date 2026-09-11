import type { DesktopCommandHandler } from "./desktop-settings-commands.js";
import type { HotkeysConfigStore } from "./hotkeys-config.js";

export function createHotkeysConfigCommandHandlers({
  hotkeysStore,
}: {
  hotkeysStore: HotkeysConfigStore;
}): Record<string, DesktopCommandHandler> {
  return {
    get_hotkeys: () => hotkeysStore.get(),
    set_hotkeys: (args) => hotkeysStore.set(args?.overrides),
  };
}
