import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { net } from "electron";
import { GithubReleaseError, type GithubReleaseCandidate } from "./github-releases.js";
import {
  APP_BUNDLE_NAME,
  readApplicationsLinkStatus,
  readBuildMetadata,
  readLocalUpdateState,
  writeLocalBuildDetails,
  writeLocalUpdateState,
} from "./local-updates.js";

const execFileAsync = promisify(execFile);
const MAX_BUILDS = 5;
const DOWNLOADS_DIR_NAME = ".downloads";
const STAGING_PREFIX = ".staging-";
const FOLDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;

export interface GithubStagedBuild {
  appPath: string;
  folder: string;
  version: string;
  commit: string;
}

/**
 * The three steps that cannot run in a unit test process: the network
 * download, the archive extraction, and launching the staged binary.
 */
export interface GithubInstallIo {
  download: (input: { url: string; destination: string }) => Promise<void>;
  extractZip: (input: { zipPath: string; destination: string }) => Promise<void>;
  smokeTest: (appPath: string) => Promise<void>;
}

function sanitizeFolderSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[^A-Za-z0-9]+/, "");
  return cleaned || "release";
}

export function resolveBuildFolderName(version: string, commit: string): string {
  const safeVersion = sanitizeFolderSegment(version);
  if (!FOLDER_PATTERN.test(safeVersion) || !COMMIT_PATTERN.test(commit)) {
    throw new GithubReleaseError("Release metadata has an unusable version or commit.");
  }
  return `${safeVersion}_${commit.slice(0, 7).toLowerCase()}`;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function protectBuildFolder(folder: string | null, protectedFolders: Set<string>): void {
  if (folder && FOLDER_PATTERN.test(folder)) protectedFolders.add(folder);
}

/**
 * Keeps the newest builds plus anything the update state or the /Applications
 * link still points at. Mirrors the local refresh script's prune rules.
 */
export function pruneLocalBuilds({
  buildsDir,
  keepFolders = [],
  maxBuilds = MAX_BUILDS,
}: {
  buildsDir: string;
  keepFolders?: string[];
  maxBuilds?: number;
}): string[] {
  const protectedFolders = new Set(keepFolders);
  const state = readLocalUpdateState({ buildsDir });
  protectBuildFolder(state?.latest.folder ?? null, protectedFolders);
  protectBuildFolder(state?.previous?.folder ?? null, protectedFolders);
  const link = readApplicationsLinkStatus({});
  if (link.target) {
    protectBuildFolder(path.basename(path.dirname(link.target)), protectedFolders);
  }

  let entries: string[] = [];
  try {
    entries = readdirSync(buildsDir);
  } catch {
    return [];
  }

  const folders: { name: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    try {
      const stats = statSync(path.join(buildsDir, entry));
      if (stats.isDirectory()) folders.push({ name: entry, mtimeMs: stats.mtimeMs });
    } catch {
      // A build folder that vanished mid-prune is already gone.
    }
  }
  folders.sort((left, right) => right.mtimeMs - left.mtimeMs);

  const pruned: string[] = [];
  folders.forEach((folder, index) => {
    if (index < maxBuilds || protectedFolders.has(folder.name)) return;
    rmSync(path.join(buildsDir, folder.name), { recursive: true, force: true });
    pruned.push(folder.name);
  });
  return pruned;
}

export async function stageGithubRelease({
  buildsDir,
  candidate,
  io,
}: {
  buildsDir: string;
  candidate: GithubReleaseCandidate;
  io: GithubInstallIo;
}): Promise<GithubStagedBuild> {
  const tag = sanitizeFolderSegment(candidate.tag);
  const downloadsDir = path.join(buildsDir, DOWNLOADS_DIR_NAME);
  const zipPath = path.join(downloadsDir, `${tag}.zip`);
  const stagingDir = path.join(buildsDir, `${STAGING_PREFIX}${tag}`);
  mkdirSync(downloadsDir, { recursive: true });
  rmSync(stagingDir, { recursive: true, force: true });

  try {
    await io.download({ url: candidate.zipAsset.downloadUrl, destination: zipPath });

    const size = statSync(zipPath).size;
    if (size <= 0) {
      throw new GithubReleaseError("Downloaded release archive is empty.");
    }
    if (candidate.zipAsset.size > 0 && size !== candidate.zipAsset.size) {
      throw new GithubReleaseError("Downloaded release archive does not match the release size.");
    }
    if (candidate.sha256 && (await sha256File(zipPath)) !== candidate.sha256) {
      throw new GithubReleaseError("Downloaded release archive failed its checksum.");
    }

    mkdirSync(stagingDir, { recursive: true });
    await io.extractZip({ zipPath, destination: stagingDir });

    const stagedAppPath = path.join(stagingDir, APP_BUNDLE_NAME);
    if (!existsSync(stagedAppPath)) {
      throw new GithubReleaseError(`Release archive did not contain ${APP_BUNDLE_NAME}.`);
    }

    // The bundle bakes its build sha at packaging time; a mismatch means the
    // downloaded archive is not the build the release metadata describes.
    // `app.getAppPath()` reads package.json through the asar from the packaged
    // app, so the file lives inside app.asar, not at the bundle root.
    const stagedMetadata = readBuildMetadata({
      appPath: path.join(stagedAppPath, "Contents", "Resources", "app.asar"),
    });
    if (stagedMetadata.buildSha !== candidate.commit) {
      throw new GithubReleaseError("Downloaded build does not match the release commit.");
    }

    await io.smokeTest(stagedAppPath);

    const folder = resolveBuildFolderName(candidate.version, candidate.commit);
    const folderPath = path.join(buildsDir, folder);
    rmSync(folderPath, { recursive: true, force: true });
    renameSync(stagingDir, folderPath);

    writeLocalBuildDetails({
      folderPath,
      details: {
        version: candidate.version,
        commit: candidate.commit,
        builtAt: candidate.builtAt,
        notes: candidate.notes,
        localChanges: candidate.localChanges,
      },
    });
    writeLocalUpdateState({
      buildsDir,
      latest: {
        folder,
        commit: candidate.commit,
        version: candidate.version,
        builtAt: candidate.builtAt,
      },
    });
    const pruned = pruneLocalBuilds({ buildsDir, keepFolders: [folder] });
    if (pruned.length > 0) {
      console.info(`[github-updates] pruned old builds: ${pruned.join(", ")}`);
    }

    return {
      appPath: path.join(folderPath, APP_BUNDLE_NAME),
      folder,
      version: candidate.version,
      commit: candidate.commit,
    };
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
    rmSync(zipPath, { force: true });
  }
}

async function downloadToFile({
  url,
  destination,
}: {
  url: string;
  destination: string;
}): Promise<void> {
  const response = await net.fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new GithubReleaseError(`Release download failed (HTTP ${response.status}).`);
  }

  const file = createWriteStream(destination);
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!file.write(value)) {
        await once(file, "drain");
      }
    }
    await new Promise<void>((resolve, reject) => {
      file.on("error", reject);
      file.on("finish", resolve);
      file.end();
    });
  } catch (error) {
    file.destroy();
    throw error;
  }
}

async function extractZip({
  zipPath,
  destination,
}: {
  zipPath: string;
  destination: string;
}): Promise<void> {
  await execFileAsync("/usr/bin/ditto", ["-x", "-k", zipPath, destination]);
}

async function smokeTestApp(appPath: string): Promise<void> {
  const executable = path.join(appPath, "Contents", "MacOS", "Paseo");
  await execFileAsync(executable, ["-e", "process.exit(0)"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
}

export function createGithubInstallIo(): GithubInstallIo {
  return {
    download: downloadToFile,
    extractZip,
    smokeTest: smokeTestApp,
  };
}
