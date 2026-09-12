import { app } from "electron";
import path from "node:path";
import { resolvePaseoHome } from "@getpaseo/server";
import {
  describeLocalUpdateDiagnostics,
  evaluateLocalUpdate,
  readApplicationsLinkStatus,
  readBuildMetadata,
  readLocalUpdateDetails,
  readLocalUpdateState,
  repointApplicationsLink,
  resolveLocalBuildsDir,
  MAC_APP_LINK,
  type ApplicationsLinkStatus,
  type LocalUpdateBuildMetadata,
  type LocalUpdateDetails,
  type LocalUpdateState,
} from "./local-updates.js";

export interface AppUpdateCheckResult {
  hasUpdate: boolean;
  readyToInstall: boolean;
  currentVersion: string;
  latestVersion: string | null;
  body: string | null;
  date: string | null;
  errorMessage: string | null;
}

export interface AppUpdateInstallResult {
  installed: boolean;
  version: string | null;
  message: string;
}

export interface LocalAppUpdateEnvironment {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  buildMetadata: LocalUpdateBuildMetadata;
}

export interface LocalAppUpdateLogger {
  info(message: string, details?: object): void;
  error(message: string, details?: object): void;
}

/**
 * Everything the service needs from the outside world, injectable so the
 * update logic is testable without a filesystem, a bundle, or an app link.
 */
export interface LocalAppUpdateIo {
  readState: () => LocalUpdateState | null;
  readDetails: (folderPath: string) => LocalUpdateDetails | null;
  getLinkStatus: () => ApplicationsLinkStatus;
}

export interface LocalAppUpdateDeps {
  environment: LocalAppUpdateEnvironment;
  buildsDir: string;
  paseoHome: string;
  io: LocalAppUpdateIo;
  repointLink: (target: string) => boolean;
  relaunch: (execPath: string) => void;
  quit: () => void;
  logger: LocalAppUpdateLogger;
}

const MAC_EXEC_PATH = path.join(MAC_APP_LINK, "Contents", "MacOS", "Paseo");

export function createLocalAppUpdateService(deps: LocalAppUpdateDeps) {
  const { environment } = deps;
  const enabled =
    environment.isPackaged &&
    environment.platform === "darwin" &&
    environment.buildMetadata.buildSha !== null;
  const runningCommit = environment.buildMetadata.buildSha;
  const runningBuiltAt = environment.buildMetadata.builtAt;

  function evaluatePendingUpdate() {
    return evaluateLocalUpdate({
      state: deps.io.readState(),
      runningCommit,
      runningBuiltAt,
    });
  }

  function checkForAppUpdate(input: { currentVersion: string }): AppUpdateCheckResult {
    const base: AppUpdateCheckResult = {
      hasUpdate: false,
      readyToInstall: false,
      currentVersion: input.currentVersion,
      latestVersion: null,
      body: null,
      date: null,
      errorMessage: null,
    };
    if (!enabled) {
      return base;
    }

    const update = evaluatePendingUpdate();
    if (!update) {
      return base;
    }

    const linkStatus = deps.io.getLinkStatus();
    const details = deps.io.readDetails(path.dirname(update.appPath));
    const body = [details?.notes ?? null, details?.localChanges ?? null]
      .filter((part): part is string => part !== null)
      .join("\n\n");
    return {
      hasUpdate: true,
      readyToInstall: linkStatus.error === null,
      currentVersion: input.currentVersion,
      latestVersion: update.version || null,
      body: body || null,
      date: update.builtAt || null,
      errorMessage: linkStatus.error,
    };
  }

  async function installAppUpdate(input: {
    currentVersion: string;
    stopDaemon: () => Promise<unknown>;
  }): Promise<AppUpdateInstallResult> {
    const check = checkForAppUpdate({ currentVersion: input.currentVersion });
    if (!check.hasUpdate || check.errorMessage !== null) {
      return {
        installed: false,
        version: null,
        message: check.errorMessage ?? "No local update is pending.",
      };
    }

    try {
      const update = evaluatePendingUpdate();
      if (!update) {
        return { installed: false, version: null, message: "No local update is pending." };
      }
      await input.stopDaemon();
      const changed = deps.repointLink(update.appPath);
      deps.logger.info(
        `[local-updates] staged build linked (changed=${changed}); restarting into it`,
        { version: update.version, commit: update.commit },
      );
      // Defer so the IPC reply flushes before the app starts quitting. The
      // relaunch executes when the app exits, so the normal quit path — daemon
      // shutdown included — runs first.
      setImmediate(() => {
        try {
          deps.relaunch(MAC_EXEC_PATH);
          deps.quit();
        } catch (error) {
          deps.logger.error("[local-updates] relaunch failed", {
            err: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return { installed: true, version: update.version || null, message: "" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.logger.error("[local-updates] failed to apply local update", { err: message });
      return { installed: false, version: null, message };
    }
  }

  function getUpdateDiagnostics(): Record<string, unknown> {
    return describeLocalUpdateDiagnostics({
      buildsDir: deps.buildsDir,
      paseoHome: deps.paseoHome,
      metadata: environment.buildMetadata,
    });
  }

  return { checkForAppUpdate, installAppUpdate, getUpdateDiagnostics, isEnabled: () => enabled };
}

export function resolveDefaultLocalBuildsDir(): string {
  return resolveLocalBuildsDir({
    environment: process.env,
    paseoHome: resolvePaseoHome(process.env),
  });
}

export function createDefaultLocalAppUpdateService() {
  const paseoHome = resolvePaseoHome(process.env);
  return createLocalAppUpdateService({
    environment: {
      isPackaged: app.isPackaged,
      platform: process.platform,
      buildMetadata: readBuildMetadata({ appPath: app.getAppPath() }),
    },
    buildsDir: resolveDefaultLocalBuildsDir(),
    paseoHome,
    io: {
      readState: () => readLocalUpdateState({ buildsDir: resolveDefaultLocalBuildsDir() }),
      readDetails: (folderPath) => readLocalUpdateDetails({ folderPath }),
      getLinkStatus: () => readApplicationsLinkStatus({}),
    },
    repointLink: (target) => repointApplicationsLink({ target }),
    relaunch: (execPath) => app.relaunch({ execPath }),
    quit: () => app.quit(),
    logger: {
      info: (message, details) => console.info(`[local-updates] ${message}`, details ?? ""),
      error: (message, details) => console.error(`[local-updates] ${message}`, details ?? ""),
    },
  });
}
