import { app } from "electron";
import log from "electron-log/main";
import path from "node:path";
import { resolvePaseoHome } from "@getpaseo/server";
import type { GithubReleaseCandidate } from "./github-releases.js";
import { createDefaultGithubUpdateSource, type GithubUpdateSource } from "./github-app-update.js";
import {
  describeLocalUpdateDiagnostics,
  evaluateLocalUpdate,
  isNewerBuild,
  readApplicationsLinkStatus,
  readBuildMetadata,
  readLocalChangelog,
  readLocalUpdateDetails,
  readLocalUpdateState,
  repointApplicationsLink,
  resolveLocalBuildsDir,
  MAC_APP_LINK,
  type ApplicationsLinkStatus,
  type LocalChangelogEntry,
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
  localChanges: string | null;
  currentCommit: string | null;
  targetCommit: string | null;
  date: string | null;
  errorMessage: string | null;
}

export type AppUpdateInstallStatus = "installed" | "up-to-date" | "failed";

export interface AppUpdateInstallResult {
  status: AppUpdateInstallStatus;
  version: string | null;
  message: string;
}

export interface AppUpdateEnvironment {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  buildMetadata: LocalUpdateBuildMetadata;
}

export interface AppUpdateLogger {
  info(message: string, details?: object): void;
  error(message: string, details?: object): void;
}

/**
 * The staged builds on this machine: the fork's original channel, still fed by
 * the local refresh script. It stays a full source next to GitHub releases.
 */
export interface LocalUpdateSource {
  readState: () => LocalUpdateState | null;
  readDetails: (folderPath: string) => LocalUpdateDetails | null;
  readChangelog: () => LocalChangelogEntry[];
  getLinkStatus: () => ApplicationsLinkStatus;
}

export interface AppUpdateDeps {
  environment: AppUpdateEnvironment;
  buildsDir: string;
  paseoHome: string;
  local: LocalUpdateSource;
  github: GithubUpdateSource;
  repointLink: (target: string) => boolean;
  relaunch: (execPath: string) => void;
  quit: () => void;
  logger: AppUpdateLogger;
}

interface SelectedUpdateBase {
  version: string | null;
  commit: string;
  builtAt: string | null;
  notes: string | null;
  localChanges: string | null;
  ready: boolean;
  errorMessage: string | null;
}

interface SelectedLocalUpdate extends SelectedUpdateBase {
  source: "local";
  appPath: string;
  release: null;
}

interface SelectedGithubUpdate extends SelectedUpdateBase {
  source: "github";
  appPath: null;
  release: GithubReleaseCandidate;
}

type SelectedUpdate = SelectedLocalUpdate | SelectedGithubUpdate;

const MAC_EXEC_PATH = path.join(MAC_APP_LINK, "Contents", "MacOS", "Paseo");

function shortCommit(commit: string | null): string | null {
  const value = commit?.trim();
  return value ? value.slice(0, 7).toLowerCase() : null;
}

function parseTime(value: string | null): number {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

function pickNewestCandidate(candidates: SelectedUpdate[]): SelectedUpdate | null {
  let best: SelectedUpdate | null = null;
  for (const candidate of candidates) {
    if (!best) {
      best = candidate;
      continue;
    }
    const bestTime = parseTime(best.builtAt);
    const candidateTime = parseTime(candidate.builtAt);
    const bestKnown = Number.isFinite(bestTime);
    const candidateKnown = Number.isFinite(candidateTime);
    if (!bestKnown && candidateKnown) {
      best = candidate;
      continue;
    }
    if (bestKnown && candidateKnown && candidateTime > bestTime) {
      best = candidate;
    }
  }
  return best;
}

export function createAppUpdateService(deps: AppUpdateDeps) {
  const { environment } = deps;
  const enabled =
    environment.isPackaged &&
    environment.platform === "darwin" &&
    environment.buildMetadata.buildSha !== null;
  const runningCommit = environment.buildMetadata.buildSha;
  const runningBuiltAt = environment.buildMetadata.builtAt;
  let pendingUpdate: SelectedUpdate | null = null;

  function buildLocalUpdate(linkStatus: ApplicationsLinkStatus): SelectedLocalUpdate | null {
    const update = evaluateLocalUpdate({
      state: deps.local.readState(),
      runningCommit,
      runningBuiltAt,
    });
    if (!update) return null;
    const details = deps.local.readDetails(path.dirname(update.appPath));
    return {
      source: "local",
      version: update.version || null,
      commit: update.commit,
      builtAt: update.builtAt || null,
      notes: details?.notes ?? null,
      localChanges: details?.localChanges ?? null,
      ready: linkStatus.error === null,
      errorMessage: linkStatus.error,
      appPath: update.appPath,
      release: null,
    };
  }

  function buildGithubUpdate(
    candidate: GithubReleaseCandidate,
    linkStatus: ApplicationsLinkStatus,
  ): SelectedGithubUpdate {
    return {
      source: "github",
      version: candidate.version,
      commit: candidate.commit,
      builtAt: candidate.builtAt,
      notes: candidate.notes,
      localChanges: candidate.localChanges,
      ready: linkStatus.error === null,
      errorMessage: linkStatus.error,
      appPath: null,
      release: candidate,
    };
  }

  function isCandidate(update: SelectedUpdate): boolean {
    return isNewerBuild({
      commit: update.commit,
      builtAt: update.builtAt,
      runningCommit,
      runningBuiltAt,
    });
  }

  async function resolveUpdate(): Promise<{
    update: SelectedUpdate | null;
    githubError: string | null;
  }> {
    const linkStatus = deps.local.getLinkStatus();
    const localUpdate = buildLocalUpdate(linkStatus);
    const githubFetch = await deps.github.fetchCandidate();
    const githubUpdate = githubFetch.candidate
      ? buildGithubUpdate(githubFetch.candidate, linkStatus)
      : null;
    const candidates = [localUpdate, githubUpdate].filter(
      (candidate): candidate is SelectedUpdate => candidate !== null && isCandidate(candidate),
    );
    const update = pickNewestCandidate(candidates);
    return { update, githubError: update ? null : githubFetch.errorMessage };
  }

  async function checkForAppUpdate(input: {
    currentVersion: string;
  }): Promise<AppUpdateCheckResult> {
    pendingUpdate = null;
    const base: AppUpdateCheckResult = {
      hasUpdate: false,
      readyToInstall: false,
      currentVersion: input.currentVersion,
      latestVersion: null,
      body: null,
      localChanges: null,
      currentCommit: shortCommit(runningCommit),
      targetCommit: null,
      date: null,
      errorMessage: null,
    };
    if (!enabled) {
      return base;
    }

    const { update, githubError } = await resolveUpdate();
    if (!update) {
      return { ...base, errorMessage: githubError };
    }

    pendingUpdate = update;
    return {
      hasUpdate: true,
      readyToInstall: update.ready,
      currentVersion: input.currentVersion,
      latestVersion: update.version,
      body: update.notes,
      localChanges: update.localChanges,
      currentCommit: shortCommit(runningCommit),
      targetCommit: shortCommit(update.commit),
      date: update.builtAt,
      errorMessage: update.errorMessage,
    };
  }

  async function installAppUpdate(input: {
    currentVersion: string;
    stopDaemon: () => Promise<unknown>;
  }): Promise<AppUpdateInstallResult> {
    if (!enabled) {
      return { status: "failed", version: null, message: "Updates are disabled for this build." };
    }

    // Resolve again instead of trusting the candidate from the last check: a
    // release can disappear between the callout and the click, and installing
    // a deleted asset would surface as a download error.
    const { update, githubError } = await resolveUpdate();
    if (!update) {
      if (githubError) {
        return { status: "failed", version: null, message: githubError };
      }
      return { status: "up-to-date", version: null, message: "No update is pending." };
    }
    if (!update.ready) {
      return {
        status: "failed",
        version: null,
        message: update.errorMessage ?? "The update cannot be installed.",
      };
    }

    try {
      let appPath: string;
      let version: string | null;
      if (update.source === "local") {
        await input.stopDaemon();
        appPath = update.appPath;
        version = update.version;
        deps.logger.info("[app-updates] linking staged local build", {
          version: update.version,
          commit: update.commit,
        });
      } else {
        // Download and stage while the daemon is still running; only the link
        // swap below needs it stopped.
        const staged = await deps.github.install(update.release);
        await input.stopDaemon();
        appPath = staged.appPath;
        version = staged.version;
        deps.logger.info("[app-updates] linking downloaded release", {
          version: staged.version,
          commit: staged.commit,
        });
      }

      const changed = deps.repointLink(appPath);
      deps.logger.info(`[app-updates] install link repointed (changed=${changed}); restarting`);
      // Defer so the IPC reply flushes before the app starts quitting. The
      // relaunch executes when the app exits, so the normal quit path — daemon
      // shutdown included — runs first.
      setImmediate(() => {
        try {
          deps.relaunch(MAC_EXEC_PATH);
          deps.quit();
        } catch (error) {
          deps.logger.error("[app-updates] relaunch failed", {
            err: error instanceof Error ? error.message : String(error),
          });
        }
      });
      pendingUpdate = null;
      return { status: "installed", version, message: "" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.logger.error("[app-updates] failed to apply update", { err: message });
      return { status: "failed", version: null, message };
    }
  }

  function getUpdateDiagnostics(): Record<string, unknown> {
    return {
      ...describeLocalUpdateDiagnostics({
        buildsDir: deps.buildsDir,
        paseoHome: deps.paseoHome,
        metadata: environment.buildMetadata,
      }),
      github: deps.github.getDiagnostics(),
    };
  }

  function getChangelog(): LocalChangelogEntry[] {
    if (!enabled) {
      return [];
    }
    const staged = deps.local.readChangelog();
    const pending = pendingUpdate;
    if (!pending || pending.source !== "github") {
      return staged;
    }
    if (staged.some((entry) => entry.commit === pending.commit)) {
      return staged;
    }
    // The pending release is not staged yet, but "What's new" must show the
    // notes the user is being asked to install.
    return [
      {
        version: pending.version ?? "",
        commit: pending.commit,
        builtAt: pending.builtAt ?? "",
        notes: pending.notes,
        localChanges: pending.localChanges,
        isRunning: false,
      },
      ...staged,
    ];
  }

  return {
    checkForAppUpdate,
    installAppUpdate,
    getChangelog,
    getUpdateDiagnostics,
    isEnabled: () => enabled,
  };
}

export function resolveDefaultLocalBuildsDir(): string {
  return resolveLocalBuildsDir({
    environment: process.env,
    paseoHome: resolvePaseoHome(process.env),
  });
}

export function createDefaultAppUpdateService() {
  const paseoHome = resolvePaseoHome(process.env);
  const buildsDir = resolveDefaultLocalBuildsDir();
  const buildMetadata = readBuildMetadata({ appPath: app.getAppPath() });
  return createAppUpdateService({
    environment: {
      isPackaged: app.isPackaged,
      platform: process.platform,
      buildMetadata,
    },
    buildsDir,
    paseoHome,
    local: {
      readState: () => readLocalUpdateState({ buildsDir }),
      readDetails: (folderPath) => readLocalUpdateDetails({ folderPath }),
      readChangelog: () => readLocalChangelog({ buildsDir, runningCommit: buildMetadata.buildSha }),
      getLinkStatus: () => readApplicationsLinkStatus({}),
    },
    github: createDefaultGithubUpdateSource({ buildsDir }),
    repointLink: (target) => repointApplicationsLink({ target }),
    relaunch: (execPath) => app.relaunch({ execPath }),
    quit: () => app.quit(),
    logger: {
      info: (message, details) => log.info(`[app-updates] ${message}`, details ?? ""),
      error: (message, details) => log.error(`[app-updates] ${message}`, details ?? ""),
    },
  });
}
