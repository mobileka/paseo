import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GithubReleaseCandidate } from "./github-releases";
import {
  pruneLocalBuilds,
  resolveBuildFolderName,
  stageGithubRelease,
  type GithubDownloadProgress,
  type GithubInstallIo,
} from "./github-install";

const COMMIT = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function makeCandidate(overrides: Partial<GithubReleaseCandidate> = {}): GithubReleaseCandidate {
  return {
    tag: "personal-20260914-1000-bbbbbbb",
    version: "0.8.0",
    commit: COMMIT,
    builtAt: "2026-09-14T10:00:00Z",
    notes: "## 0.8.0",
    localChanges: "- fix: remote thing (bbbbbbb)",
    publishedAt: "2026-09-14T10:01:00Z",
    zipAsset: {
      name: "Paseo-arm64.zip",
      downloadUrl: "https://example.test/Paseo-arm64.zip",
      size: 0,
    },
    metadataAsset: {
      name: "build.json",
      downloadUrl: "https://example.test/build.json",
      size: 100,
    },
    sha256: null,
    ...overrides,
  };
}

function fakeIo({
  buildSha = COMMIT,
  includeApp = true,
}: {
  buildSha?: string;
  includeApp?: boolean;
} = {}): GithubInstallIo {
  return {
    download: async ({ destination }) => {
      writeFileSync(destination, "archive-contents");
    },
    extractZip: async ({ destination }) => {
      if (!includeApp) return;
      const asarDir = path.join(destination, "Paseo.app", "Contents", "Resources", "app.asar");
      mkdirSync(asarDir, { recursive: true });
      writeFileSync(path.join(asarDir, "package.json"), JSON.stringify({ buildSha }));
    },
    smokeTest: async () => undefined,
  };
}

const tempDirs: string[] = [];

function makeTempBuildsDir(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "paseo-github-updates-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("resolveBuildFolderName", () => {
  it("builds version_shortsha folders", () => {
    expect(resolveBuildFolderName("0.8.0", COMMIT)).toBe("0.8.0_bbbbbbb");
  });

  it("rejects unusable metadata", () => {
    expect(() => resolveBuildFolderName("", "not-a-sha")).toThrow("unusable version or commit");
  });
});

describe("stageGithubRelease", () => {
  it("forwards download progress and the declared size to the install io", async () => {
    const buildsDir = makeTempBuildsDir();
    const zipBytes = "0123456789";
    const seenTotalBytes: number[] = [];
    const io: GithubInstallIo = {
      download: async ({ destination, totalBytes, onProgress }) => {
        seenTotalBytes.push(totalBytes ?? 0);
        onProgress?.({ receivedBytes: 5, totalBytes: totalBytes ?? 0 });
        writeFileSync(destination, zipBytes);
        onProgress?.({ receivedBytes: zipBytes.length, totalBytes: totalBytes ?? 0 });
      },
      extractZip: fakeIo().extractZip,
      smokeTest: async () => undefined,
    };
    const progress: GithubDownloadProgress[] = [];

    await stageGithubRelease({
      buildsDir,
      candidate: makeCandidate({
        zipAsset: {
          name: "Paseo-arm64.zip",
          downloadUrl: "https://example.test/Paseo-arm64.zip",
          size: zipBytes.length,
        },
      }),
      io,
      onProgress: (update) => progress.push(update),
    });

    expect(seenTotalBytes).toEqual([zipBytes.length]);
    expect(progress).toEqual([
      { receivedBytes: 5, totalBytes: 10 },
      { receivedBytes: 10, totalBytes: 10 },
    ]);
  });

  it("stages the app, writes build.json and state.json", async () => {
    const buildsDir = makeTempBuildsDir();
    const staged = await stageGithubRelease({
      buildsDir,
      candidate: makeCandidate(),
      io: fakeIo(),
    });

    expect(staged.folder).toBe("0.8.0_bbbbbbb");
    expect(staged.appPath).toBe(path.join(buildsDir, "0.8.0_bbbbbbb", "Paseo.app"));
    expect(existsSync(staged.appPath)).toBe(true);

    const details = JSON.parse(
      readFileSync(path.join(buildsDir, "0.8.0_bbbbbbb", "build.json"), "utf8"),
    );
    expect(details).toEqual({
      version: "0.8.0",
      commit: COMMIT,
      builtAt: "2026-09-14T10:00:00Z",
      notes: "## 0.8.0",
      localChanges: "- fix: remote thing (bbbbbbb)",
    });

    const state = JSON.parse(readFileSync(path.join(buildsDir, "state.json"), "utf8"));
    expect(state.latest).toEqual({
      folder: "0.8.0_bbbbbbb",
      commit: COMMIT,
      version: "0.8.0",
      builtAt: "2026-09-14T10:00:00Z",
    });
    expect(state.previous).toBeNull();
  });

  it("keeps the previous build in state.json", async () => {
    const buildsDir = makeTempBuildsDir();
    const previousFolder = path.join(buildsDir, "0.8.0_aaaaaaa");
    mkdirSync(path.join(previousFolder, "Paseo.app"), { recursive: true });
    writeFileSync(
      path.join(buildsDir, "state.json"),
      JSON.stringify({
        latest: {
          folder: "0.8.0_aaaaaaa",
          commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          version: "0.8.0",
          builtAt: "2026-09-10T10:00:00Z",
        },
        previous: null,
        updatedAt: "2026-09-10T10:00:00Z",
      }),
    );

    await stageGithubRelease({ buildsDir, candidate: makeCandidate(), io: fakeIo() });

    const state = JSON.parse(readFileSync(path.join(buildsDir, "state.json"), "utf8"));
    expect(state.previous).toEqual({
      folder: "0.8.0_aaaaaaa",
      commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      version: "0.8.0",
      builtAt: "2026-09-10T10:00:00Z",
    });
  });

  it("rejects a build whose baked commit does not match", async () => {
    const buildsDir = makeTempBuildsDir();
    await expect(
      stageGithubRelease({
        buildsDir,
        candidate: makeCandidate(),
        io: fakeIo({ buildSha: "cccccccccccccccccccccccccccccccccccccccc" }),
      }),
    ).rejects.toThrow("does not match the release commit");
    expect(existsSync(path.join(buildsDir, "0.8.0_bbbbbbb"))).toBe(false);
    expect(existsSync(path.join(buildsDir, "state.json"))).toBe(false);
  });

  it("rejects an archive without the app bundle", async () => {
    const buildsDir = makeTempBuildsDir();
    await expect(
      stageGithubRelease({
        buildsDir,
        candidate: makeCandidate(),
        io: fakeIo({ includeApp: false }),
      }),
    ).rejects.toThrow("did not contain Paseo.app");
  });

  it("rejects a checksum mismatch", async () => {
    const buildsDir = makeTempBuildsDir();
    const expected = createHash("sha256").update("different-contents").digest("hex");
    await expect(
      stageGithubRelease({
        buildsDir,
        candidate: makeCandidate({ sha256: expected }),
        io: fakeIo(),
      }),
    ).rejects.toThrow("failed its checksum");
    expect(existsSync(path.join(buildsDir, "0.8.0_bbbbbbb"))).toBe(false);
  });

  it("rejects an archive whose size does not match the release", async () => {
    const buildsDir = makeTempBuildsDir();
    await expect(
      stageGithubRelease({
        buildsDir,
        candidate: makeCandidate({
          zipAsset: {
            name: "Paseo-arm64.zip",
            downloadUrl: "https://example.test/Paseo-arm64.zip",
            size: 999,
          },
        }),
        io: fakeIo(),
      }),
    ).rejects.toThrow("does not match the release size");
  });

  it("removes the downloaded archive after staging", async () => {
    const buildsDir = makeTempBuildsDir();
    await stageGithubRelease({ buildsDir, candidate: makeCandidate(), io: fakeIo() });
    const downloadsDir = path.join(buildsDir, ".downloads");
    expect(existsSync(downloadsDir) && readdirSync(downloadsDir).length === 0).toBe(true);
  });
});

describe("pruneLocalBuilds", () => {
  it("keeps the newest builds and protects the state folders", () => {
    const buildsDir = makeTempBuildsDir();
    const names = ["build-1", "build-2", "build-3", "build-4", "build-5", "build-6"];
    names.forEach((name, index) => {
      const folder = path.join(buildsDir, name, "Paseo.app");
      mkdirSync(folder, { recursive: true });
      const time = new Date(2026, 0, index + 1);
      utimesSync(path.join(buildsDir, name), time, time);
    });

    const pruned = pruneLocalBuilds({ buildsDir, keepFolders: ["build-6"] });
    expect(pruned).toContain("build-1");
    expect(existsSync(path.join(buildsDir, "build-1"))).toBe(false);
    expect(existsSync(path.join(buildsDir, "build-6"))).toBe(true);
  });
});
