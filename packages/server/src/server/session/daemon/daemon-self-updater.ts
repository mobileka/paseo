export type DaemonSelfUpdatePhase = "starting" | "downloading" | "installing" | "complete";

export interface DaemonSelfUpdateResult {
  success: boolean;
  error: string | null;
  newVersion: string | null;
}

export interface DaemonSelfUpdateInput {
  daemonVersion: string | null;
  desktopManaged: boolean;
  onProgress: (phase: DaemonSelfUpdatePhase) => void;
  logger: DaemonSelfUpdateLogger;
}

export interface DaemonSelfUpdateLogger {
  error(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export class DaemonSelfUpdateInProgressError extends Error {
  constructor() {
    super("An update is already in progress");
    this.name = "DaemonSelfUpdateInProgressError";
  }
}

const DESKTOP_MANAGED_UPDATE_ERROR =
  "This daemon is managed by Paseo Desktop. Update Paseo Desktop on the host.";

export const SELF_UPDATE_DISABLED_ERROR =
  "Self-update is disabled in this fork. Update Paseo Desktop on the host.";

/**
 * The fork takes updates from the local build channel, never from the npm
 * registry, so the only correct answer is a refusal. The RPC surface stays so
 * older clients get a clean error instead of an unknown-message failure.
 */
export class DaemonSelfUpdater {
  async update(input: DaemonSelfUpdateInput): Promise<DaemonSelfUpdateResult> {
    return {
      success: false,
      error: input.desktopManaged ? DESKTOP_MANAGED_UPDATE_ERROR : SELF_UPDATE_DISABLED_ERROR,
      newVersion: null,
    };
  }
}

export const daemonSelfUpdater = new DaemonSelfUpdater();
