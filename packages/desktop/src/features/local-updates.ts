import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

export const STATE_FILE_NAME = "state.json";
export const BUILD_FILE_NAME = "build.json";
export const APP_BUNDLE_NAME = "Paseo.app";
export const MAC_APP_LINK = "/Applications/Paseo.app";

const FOLDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;

export interface LocalUpdateBuildMetadata {
  buildSha: string | null;
  builtAt: string | null;
}

export interface LocalUpdateEntry {
  folder: string;
  commit: string;
  version: string;
  builtAt: string;
  appPath: string;
}

export interface LocalUpdateState {
  latest: LocalUpdateEntry;
  previous: LocalUpdateEntry | null;
  updatedAt: string | null;
}

export interface LocalUpdateDetails {
  notes: string | null;
  localChanges: string | null;
}

type ReadFileFn = (filePath: string, encoding: "utf8") => string;
type ExistsFn = (filePath: string) => boolean;

export function resolveLocalBuildsDir({
  environment = process.env,
  paseoHome,
}: {
  environment?: NodeJS.ProcessEnv;
  paseoHome: string;
}): string {
  const configured =
    typeof environment.PASEO_BUILDS_DIR === "string" ? environment.PASEO_BUILDS_DIR.trim() : "";
  if (configured) {
    return path.resolve(expandHomeDir(configured));
  }
  return path.join(paseoHome, "builds");
}

function expandHomeDir(input: string): string {
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function parseTime(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readText(readFile: ReadFileFn, filePath: string): string | null {
  try {
    return readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * The build stamp the packaging step injects into the bundled package.json
 * (`extraMetadata.buildSha`/`builtAt`). A bundle without a valid `buildSha`
 * is not a fork build: the local update channel stays off for it.
 */
export function readBuildMetadata({
  appPath,
  readFile = readFileSync,
}: {
  appPath: string;
  readFile?: ReadFileFn;
}): LocalUpdateBuildMetadata {
  const raw = readText(readFile, path.join(appPath, "package.json"));
  if (!raw) {
    return { buildSha: null, builtAt: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { buildSha: null, builtAt: null };
  }
  const buildSha =
    typeof (parsed as { buildSha?: unknown }).buildSha === "string" &&
    COMMIT_PATTERN.test((parsed as { buildSha: string }).buildSha)
      ? (parsed as { buildSha: string }).buildSha.toLowerCase()
      : null;
  const builtAt =
    typeof (parsed as { builtAt?: unknown }).builtAt === "string"
      ? (parsed as { builtAt: string }).builtAt
      : null;
  return { buildSha, builtAt };
}

export function isLocalUpdateBuild(metadata: LocalUpdateBuildMetadata): boolean {
  return metadata.buildSha !== null;
}

function parseEntry(entry: unknown, buildsDir: string, exists: ExistsFn): LocalUpdateEntry | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const folder = typeof record.folder === "string" ? record.folder.trim() : "";
  const commit = typeof record.commit === "string" ? record.commit.trim() : "";
  if (!folder || folder === "." || folder === ".." || !FOLDER_PATTERN.test(folder)) return null;
  if (!COMMIT_PATTERN.test(commit)) return null;
  const appPath = path.join(buildsDir, folder, APP_BUNDLE_NAME);
  if (!exists(appPath)) return null;
  return {
    folder,
    commit: commit.toLowerCase(),
    version: typeof record.version === "string" ? record.version.trim() : "",
    builtAt: typeof record.builtAt === "string" ? record.builtAt.trim() : "",
    appPath,
  };
}

export function readLocalUpdateState({
  buildsDir,
  readFile = readFileSync,
  exists = existsSync,
}: {
  buildsDir: string;
  readFile?: ReadFileFn;
  exists?: ExistsFn;
}): LocalUpdateState | null {
  const raw = readText(readFile, path.join(buildsDir, STATE_FILE_NAME));
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const latest = parseEntry((parsed as { latest?: unknown })?.latest, buildsDir, exists);
  if (!latest) return null;
  return {
    latest,
    previous: parseEntry((parsed as { previous?: unknown })?.previous, buildsDir, exists),
    updatedAt:
      typeof (parsed as { updatedAt?: unknown })?.updatedAt === "string"
        ? (parsed as { updatedAt: string }).updatedAt
        : null,
  };
}

export function evaluateLocalUpdate({
  state,
  runningCommit = null,
  runningBuiltAt = null,
}: {
  state: LocalUpdateState | null;
  runningCommit?: string | null;
  runningBuiltAt?: string | null;
}): LocalUpdateEntry | null {
  const latest = state?.latest;
  if (!latest) return null;
  if (typeof runningCommit === "string" && runningCommit.trim().toLowerCase() === latest.commit) {
    return null;
  }
  const runningTime = parseTime(runningBuiltAt);
  const candidateTime = parseTime(latest.builtAt);
  if (runningTime !== null && candidateTime !== null && candidateTime <= runningTime) {
    return null;
  }
  return latest;
}

export function readLocalUpdateDetails({
  folderPath,
  readFile = readFileSync,
}: {
  folderPath: string;
  readFile?: ReadFileFn;
}): LocalUpdateDetails | null {
  const raw = readText(readFile, path.join(folderPath, BUILD_FILE_NAME));
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const notes =
    typeof (parsed as { notes?: unknown })?.notes === "string" &&
    (parsed as { notes: string }).notes.trim()
      ? (parsed as { notes: string }).notes.trim()
      : null;
  const localChanges =
    typeof (parsed as { localChanges?: unknown })?.localChanges === "string" &&
    (parsed as { localChanges: string }).localChanges.trim()
      ? (parsed as { localChanges: string }).localChanges.trim()
      : null;
  if (!notes && !localChanges) return null;
  return { notes, localChanges };
}

export interface ApplicationsLinkStatus {
  isSymlink: boolean;
  target: string | null;
  error: string | null;
}

export function readApplicationsLinkStatus({
  linkPath = MAC_APP_LINK,
  lstat = lstatSync,
  readlink = readlinkSync,
}: {
  linkPath?: string;
  lstat?: (filePath: string) => { isSymbolicLink(): boolean };
  readlink?: (filePath: string) => string;
}): ApplicationsLinkStatus {
  try {
    if (!lstat(linkPath).isSymbolicLink()) {
      return {
        isSymlink: false,
        target: null,
        error: `${linkPath} is not a symlink. Install the fork build once by linking it into /Applications.`,
      };
    }
    return { isSymlink: true, target: readlink(linkPath), error: null };
  } catch {
    return {
      isSymlink: false,
      target: null,
      error: `Paseo is not installed at ${linkPath}`,
    };
  }
}

/**
 * Repoints the /Applications symlink at the staged build. The link is the
 * whole install: if it is missing or a real app bundle, updating would
 * scatter builds across machines, so this refuses instead of guessing. A
 * failed re-link restores the previous target so the app never ends up
 * pointing at nothing.
 */
export function repointApplicationsLink({
  target,
  linkPath = MAC_APP_LINK,
  lstat = lstatSync,
  readlink,
  unlink = unlinkSync,
  symlink = symlinkSync,
}: {
  target: string;
  linkPath?: string;
  lstat?: (filePath: string) => { isSymbolicLink(): boolean };
  readlink?: (filePath: string) => string;
  unlink?: (filePath: string) => void;
  symlink?: (target: string, filePath: string) => void;
}): boolean {
  const readlinkFn = readlink ?? readlinkSync;
  let stats: { isSymbolicLink(): boolean };
  try {
    stats = lstat(linkPath);
  } catch {
    throw new Error(`Paseo is not installed at ${linkPath}`);
  }
  if (!stats.isSymbolicLink()) {
    throw new Error(
      `${linkPath} is not a symlink. Install the fork build once by linking it into /Applications.`,
    );
  }
  const currentTarget = readlinkFn(linkPath);
  if (currentTarget === target) return false;
  unlink(linkPath);
  try {
    symlink(target, linkPath);
  } catch (error) {
    try {
      symlink(currentTarget, linkPath);
    } catch {
      // Nothing left to restore with; surface the original failure.
    }
    throw error;
  }
  return true;
}

export function describeLocalUpdateDiagnostics({
  buildsDir,
  paseoHome,
  metadata,
  linkPath = MAC_APP_LINK,
  lstat = lstatSync,
  readFile = readFileSync,
}: {
  buildsDir: string;
  paseoHome: string;
  metadata: LocalUpdateBuildMetadata;
  linkPath?: string;
  lstat?: (filePath: string) => { isSymbolicLink(): boolean };
  readFile?: ReadFileFn;
}): Record<string, unknown> {
  const statePath = path.join(buildsDir, STATE_FILE_NAME);
  let stateContents: string | null = null;
  let stateError: string | null = null;
  try {
    stateContents = readFile(statePath, "utf8");
  } catch (error) {
    stateError = error instanceof Error ? error.message : String(error);
  }
  const appLink = readApplicationsLinkStatus({ linkPath, lstat, readlink: readlinkSync });
  return {
    platform: process.platform,
    home: paseoHome,
    buildsDir,
    runningBuildSha: metadata.buildSha,
    builtAt: metadata.builtAt,
    stateFile: { path: statePath, contents: stateContents, error: stateError },
    appLink: {
      path: linkPath,
      isSymlink: appLink.isSymlink,
      target: appLink.target,
      error: appLink.error,
    },
  };
}
