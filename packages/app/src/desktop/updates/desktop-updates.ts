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
  date: string | null;
  errorMessage: string | null;
}

export interface DesktopAppUpdateInstallResult {
  installed: boolean;
  version: string | null;
  message: string;
}

export type DesktopAppUpdateCheckIntent = "automatic" | "manual";

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
    date: toStringOrNull(result.date),
    errorMessage: toStringOrNull(result.errorMessage),
  };
}

export async function installDesktopAppUpdate(): Promise<DesktopAppUpdateInstallResult> {
  const result = await invokeDesktopCommand<unknown>("install_app_update");
  if (!isRecord(result)) {
    throw new Error("Unexpected response while installing desktop update.");
  }

  return {
    installed: result.installed === true,
    version: toStringOrNull(result.version),
    message: toStringOrNull(result.message) ?? i18n.t("desktop.updates.status.installed"),
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
