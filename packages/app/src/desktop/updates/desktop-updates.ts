import { isElectronRuntime } from "@/desktop/host";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { isWeb } from "@/constants/platform";
import { i18n } from "@/i18n/i18next";

export interface DesktopAppUpdateCheckResult {
  hasUpdate: boolean;
  readyToInstall: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  body: string | null;
  localChanges: string | null;
  currentCommit: string | null;
  targetCommit: string | null;
  date: string | null;
  errorMessage: string | null;
}

export type DesktopAppUpdateInstallStatus = "installed" | "up-to-date" | "failed";

export interface DesktopAppUpdateInstallResult {
  status: DesktopAppUpdateInstallStatus;
  version: string | null;
  message: string;
}

export type DesktopAppUpdateCheckIntent = "automatic" | "manual";

export interface DesktopAppUpdateProgress {
  percent: number | null;
  receivedBytes: number;
  totalBytes: number;
}

export interface LocalDaemonVersionResult {
  version: string | null;
  error: string | null;
}

export interface LocalChangelogEntry {
  version: string;
  commit: string;
  builtAt: string;
  notes: string | null;
  localChanges: string | null;
  isRunning: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function shouldShowDesktopUpdateSection(): boolean {
  return isWeb && isElectronRuntime();
}

export function parseLocalDaemonVersionResult(raw: unknown): LocalDaemonVersionResult {
  if (!isRecord(raw)) {
    return { version: null, error: "Unexpected response from version check." };
  }

  return {
    version: toStringOrNull(raw.version),
    error: toStringOrNull(raw.error),
  };
}

export function parseDesktopAppUpdateProgress(raw: unknown): DesktopAppUpdateProgress | null {
  if (!isRecord(raw)) {
    return null;
  }
  const receivedBytes =
    typeof raw.receivedBytes === "number" && Number.isFinite(raw.receivedBytes)
      ? raw.receivedBytes
      : null;
  const totalBytes =
    typeof raw.totalBytes === "number" && Number.isFinite(raw.totalBytes) ? raw.totalBytes : null;
  if (receivedBytes === null || totalBytes === null) {
    return null;
  }
  const percent =
    typeof raw.percent === "number" && Number.isFinite(raw.percent)
      ? Math.min(100, Math.max(0, raw.percent))
      : null;
  return { percent, receivedBytes, totalBytes };
}

export async function getLocalDaemonVersion(): Promise<LocalDaemonVersionResult> {
  const result = await invokeDesktopCommand<unknown>("get_local_daemon_version");
  return parseLocalDaemonVersionResult(result);
}

export function parseLocalChangelogEntry(raw: unknown): LocalChangelogEntry | null {
  if (!isRecord(raw)) {
    return null;
  }

  const version = toStringOrNull(raw.version);
  if (!version) {
    return null;
  }

  return {
    version,
    commit: toStringOrEmpty(raw.commit),
    builtAt: toStringOrEmpty(raw.builtAt),
    notes: toStringOrNull(raw.notes),
    localChanges: toStringOrNull(raw.localChanges),
    isRunning: raw.isRunning === true,
  };
}

export function parseLocalChangelog(raw: unknown): LocalChangelogEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map(parseLocalChangelogEntry)
    .filter((entry): entry is LocalChangelogEntry => entry !== null);
}

export async function getLocalChangelog(): Promise<LocalChangelogEntry[]> {
  const result = await invokeDesktopCommand<unknown>("get_local_changelog");
  return parseLocalChangelog(result);
}

export async function checkDesktopAppUpdate({
  intent,
}: {
  intent: DesktopAppUpdateCheckIntent;
}): Promise<DesktopAppUpdateCheckResult> {
  const result = await invokeDesktopCommand<unknown>("check_app_update", {
    intent,
  });
  if (!isRecord(result)) {
    throw new Error("Unexpected response while checking desktop updates.");
  }

  return {
    hasUpdate: result.hasUpdate === true,
    readyToInstall: result.readyToInstall === true,
    currentVersion: toStringOrNull(result.currentVersion),
    latestVersion: toStringOrNull(result.latestVersion),
    body: toStringOrNull(result.body),
    localChanges: toStringOrNull(result.localChanges),
    currentCommit: toStringOrNull(result.currentCommit),
    targetCommit: toStringOrNull(result.targetCommit),
    date: toStringOrNull(result.date),
    errorMessage: toStringOrNull(result.errorMessage),
  };
}

function parseInstallStatus(value: unknown): DesktopAppUpdateInstallStatus {
  if (value === "installed" || value === "up-to-date" || value === "failed") {
    return value;
  }
  throw new Error("Unexpected response while installing desktop update.");
}

export async function installDesktopAppUpdate(): Promise<DesktopAppUpdateInstallResult> {
  const result = await invokeDesktopCommand<unknown>("install_app_update");
  if (!isRecord(result)) {
    throw new Error("Unexpected response while installing desktop update.");
  }

  const status = parseInstallStatus(result.status);
  const message = toStringOrNull(result.message);
  return {
    status,
    version: toStringOrNull(result.version),
    message: message ?? (status === "installed" ? i18n.t("desktop.updates.status.installed") : ""),
  };
}

export function normalizeVersionForComparison(version: string | null | undefined): string | null {
  const value = version?.trim();
  if (!value) {
    return null;
  }

  return value.replace(/^v/i, "");
}

export function isVersionMismatch(
  appVersion: string | null | undefined,
  daemonVersion: string | null | undefined,
): boolean {
  const app = normalizeVersionForComparison(appVersion);
  const daemon = normalizeVersionForComparison(daemonVersion);

  if (!app || !daemon) {
    return false;
  }

  return app !== daemon;
}

export function formatVersionWithPrefix(version: string | null | undefined): string {
  const value = version?.trim();
  if (!value) {
    return "\u2014";
  }

  return value.startsWith("v") ? value : `v${value}`;
}

export function normalizeBuildCommit(commit: string | null | undefined): string | null {
  const value = commit?.trim();
  return value ? value.slice(0, 7).toLowerCase() : null;
}

/**
 * Local fork builds keep the upstream version, so the short commit is the only
 * thing that tells two builds apart. "v0.8.0 · 4eea92a".
 */
export function formatBuildLabel(
  version: string | null | undefined,
  commit: string | null | undefined,
): string {
  const versionLabel = formatVersionWithPrefix(version);
  const commitLabel = normalizeBuildCommit(commit);
  if (!commitLabel) {
    return versionLabel;
  }
  if (versionLabel === "\u2014") {
    return commitLabel;
  }
  return `${versionLabel} \u00b7 ${commitLabel}`;
}
