import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  APP_BUNDLE_NAME,
  BUILD_FILE_NAME,
  evaluateLocalUpdate,
  readBuildMetadata,
  readLocalUpdateDetails,
  readLocalUpdateState,
  readLocalUpdateStateSignature,
  repointApplicationsLink,
  resolveLocalBuildsDir,
  STATE_FILE_NAME,
} from "./local-updates";

let testDir: string | null = null;

function makeBuildsDir(): string {
  testDir = mkdtempSync(path.join(tmpdir(), "paseo-local-updates-"));
  return path.join(testDir, "builds");
}

afterEach(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true });
    testDir = null;
  }
});

function stageBuild(
  buildsDir: string,
  folder: string,
  entry: Record<string, unknown>,
  options: { withBundle?: boolean; withBuildJson?: Record<string, unknown> } = {},
): void {
  const buildDir = path.join(buildsDir, folder);
  mkdirSync(buildDir, { recursive: true });
  if (options.withBundle !== false) {
    mkdirSync(path.join(buildDir, APP_BUNDLE_NAME), { recursive: true });
  }
  if (options.withBuildJson) {
    writeFileSync(
      path.join(buildDir, BUILD_FILE_NAME),
      JSON.stringify(options.withBuildJson, null, 2),
    );
  }
  writeFileSync(path.join(buildsDir, STATE_FILE_NAME), JSON.stringify(entry, null, 2));
}

const LATEST_ENTRY = {
  latest: {
    folder: "0.9.0_abcdef1",
    commit: "abcdef1234567890",
    version: "0.9.0",
    builtAt: "2026-09-12T10:00:00Z",
  },
  updatedAt: "2026-09-12T10:00:00Z",
};

describe("resolveLocalBuildsDir", () => {
  it("prefers the environment override", () => {
    expect(
      resolveLocalBuildsDir({
        environment: { PASEO_BUILDS_DIR: "/tmp/custom-builds" },
        paseoHome: "/home/user/.paseo",
      }),
    ).toBe("/tmp/custom-builds");
  });

  it("falls back to builds inside the paseo home", () => {
    expect(resolveLocalBuildsDir({ environment: {}, paseoHome: "/home/user/.paseo" })).toBe(
      "/home/user/.paseo/builds",
    );
  });

  it("expands a home-relative override", () => {
    expect(
      resolveLocalBuildsDir({
        environment: { PASEO_BUILDS_DIR: "~/fork-builds" },
        paseoHome: "/home/user/.paseo",
      }),
    ).toBe(path.join(homedir(), "fork-builds"));
  });
});

describe("readBuildMetadata", () => {
  it("reads the packaging stamp from the bundle package.json", () => {
    const appPath = "/fake/app";
    const metadata = readBuildMetadata({
      appPath,
      readFile: (filePath) =>
        filePath === path.join(appPath, "package.json")
          ? JSON.stringify({ buildSha: "ABCDEF1234567890", builtAt: "2026-09-12T09:00:00Z" })
          : "{}",
    });
    expect(metadata).toEqual({ buildSha: "abcdef1234567890", builtAt: "2026-09-12T09:00:00Z" });
  });

  it("rejects a malformed build sha", () => {
    const metadata = readBuildMetadata({
      appPath: "/fake/app",
      readFile: () => JSON.stringify({ buildSha: "not-a-sha" }),
    });
    expect(metadata.buildSha).toBeNull();
  });

  it("returns nulls when the package metadata is missing", () => {
    const metadata = readBuildMetadata({ appPath: "/fake/app", readFile: () => "{}" });
    expect(metadata).toEqual({ buildSha: null, builtAt: null });
  });
});

describe("readLocalUpdateState", () => {
  it("returns null when the state file is missing or corrupt", () => {
    const buildsDir = makeBuildsDir();
    expect(readLocalUpdateState({ buildsDir })).toBeNull();
    mkdirSync(buildsDir, { recursive: true });
    writeFileSync(path.join(buildsDir, STATE_FILE_NAME), "{not json");
    expect(readLocalUpdateState({ buildsDir })).toBeNull();
  });

  it("returns null when the latest entry has no app bundle on disk", () => {
    const buildsDir = makeBuildsDir();
    stageBuild(buildsDir, "0.9.0_abcdef1", LATEST_ENTRY, { withBundle: false });
    expect(readLocalUpdateState({ buildsDir })).toBeNull();
  });

  it("reads the latest and previous entries", () => {
    const buildsDir = makeBuildsDir();
    mkdirSync(path.join(buildsDir, "0.9.0_abcdef1", APP_BUNDLE_NAME), { recursive: true });
    mkdirSync(path.join(buildsDir, "0.8.0_1111111", APP_BUNDLE_NAME), { recursive: true });
    writeFileSync(
      path.join(buildsDir, STATE_FILE_NAME),
      JSON.stringify({
        latest: LATEST_ENTRY.latest,
        previous: {
          folder: "0.8.0_1111111",
          commit: "1111111222233334",
          version: "0.8.0",
          builtAt: "2026-09-01T10:00:00Z",
        },
        updatedAt: "2026-09-12T10:00:00Z",
      }),
    );
    const state = readLocalUpdateState({ buildsDir });
    expect(state?.latest.commit).toBe("abcdef1234567890");
    expect(state?.previous?.folder).toBe("0.8.0_1111111");
  });
});

describe("evaluateLocalUpdate", () => {
  const buildsDir = "/fake/builds";
  const state = readLocalUpdateState({
    buildsDir,
    readFile: () => JSON.stringify(LATEST_ENTRY),
    exists: () => true,
  });

  it("returns null without state", () => {
    expect(evaluateLocalUpdate({ state: null, runningCommit: "aaa" })).toBeNull();
  });

  it("returns null when the running build is the latest", () => {
    expect(evaluateLocalUpdate({ state, runningCommit: "ABCDEF1234567890" })).toBeNull();
  });

  it("returns null when the candidate is not newer by builtAt", () => {
    expect(
      evaluateLocalUpdate({
        state,
        runningCommit: "0000000000000000",
        runningBuiltAt: "2026-09-12T12:00:00Z",
      }),
    ).toBeNull();
  });

  it("offers the latest build for a different, older running commit", () => {
    const update = evaluateLocalUpdate({
      state,
      runningCommit: "0000000000000000",
      runningBuiltAt: "2026-09-01T00:00:00Z",
    });
    expect(update?.commit).toBe("abcdef1234567890");
    expect(update?.appPath).toBe(path.join(buildsDir, "0.9.0_abcdef1", APP_BUNDLE_NAME));
  });
});

describe("readLocalUpdateDetails", () => {
  it("reads notes and local changes", () => {
    const details = readLocalUpdateDetails({
      folderPath: "/fake/build",
      readFile: () =>
        JSON.stringify({ notes: "## [0.9.0]", localChanges: "- feat: something (abc1234)" }),
    });
    expect(details).toEqual({
      notes: "## [0.9.0]",
      localChanges: "- feat: something (abc1234)",
    });
  });

  it("returns null when nothing is present", () => {
    expect(readLocalUpdateDetails({ folderPath: "/fake/build", readFile: () => "{}" })).toBeNull();
    expect(
      readLocalUpdateDetails({ folderPath: "/fake/build", readFile: () => "nope" }),
    ).toBeNull();
  });
});

describe("readLocalUpdateStateSignature", () => {
  it("is empty while the state file is missing", () => {
    const buildsDir = makeBuildsDir();
    mkdirSync(buildsDir, { recursive: true });
    expect(readLocalUpdateStateSignature({ buildsDir })).toBe("");
  });

  it("changes when the state file changes and is stable otherwise", () => {
    const buildsDir = makeBuildsDir();
    mkdirSync(buildsDir, { recursive: true });
    writeFileSync(path.join(buildsDir, STATE_FILE_NAME), "{}");
    const first = readLocalUpdateStateSignature({ buildsDir });
    expect(first).not.toBe("");

    expect(readLocalUpdateStateSignature({ buildsDir })).toBe(first);

    writeFileSync(path.join(buildsDir, STATE_FILE_NAME), "{}\n");
    const second = readLocalUpdateStateSignature({ buildsDir });
    expect(second).not.toBe(first);
  });
});

describe("repointApplicationsLink", () => {
  function fakeFs(linkPath: string, initialTarget: string) {
    let target: string | null = initialTarget;
    let exists = true;
    const calls: string[] = [];
    return {
      calls,
      lstat: (filePath: string) => {
        if (filePath === linkPath && exists) {
          return { isSymbolicLink: () => true };
        }
        throw new Error("ENOENT");
      },
      readlink: (filePath: string) => {
        if (filePath !== linkPath || target === null) throw new Error("ENOENT");
        return target;
      },
      unlink: (filePath: string) => {
        calls.push(`unlink:${filePath}`);
        exists = false;
      },
      symlink: (newTarget: string, filePath: string) => {
        calls.push(`symlink:${filePath}`);
        if (newTarget === "/broken/target") {
          throw new Error("EACCES");
        }
        target = newTarget;
        exists = true;
      },
      current: () => target,
    };
  }

  it("repoints and reports when the target changed", () => {
    const fs = fakeFs("/Applications/Paseo.app", "/old/build/Paseo.app");
    const changed = repointApplicationsLink({
      target: "/new/build/Paseo.app",
      lstat: fs.lstat,
      readlink: fs.readlink,
      unlink: fs.unlink,
      symlink: fs.symlink,
    });
    expect(changed).toBe(true);
    expect(fs.current()).toBe("/new/build/Paseo.app");
  });

  it("is a no-op when already pointing at the target", () => {
    const fs = fakeFs("/Applications/Paseo.app", "/new/build/Paseo.app");
    const changed = repointApplicationsLink({
      target: "/new/build/Paseo.app",
      lstat: fs.lstat,
      readlink: fs.readlink,
      unlink: fs.unlink,
      symlink: fs.symlink,
    });
    expect(changed).toBe(false);
    expect(fs.calls).toEqual([]);
  });

  it("refuses a missing or non-symlink install", () => {
    const fs = fakeFs("/Applications/Paseo.app", "/old/Paseo.app");
    const missing = () =>
      repointApplicationsLink({
        target: "/new/Paseo.app",
        lstat: () => {
          throw new Error("ENOENT");
        },
      });
    expect(missing).toThrow("Paseo is not installed at /Applications/Paseo.app");
    const notALink = () =>
      repointApplicationsLink({
        target: "/new/Paseo.app",
        lstat: () => ({ isSymbolicLink: () => false }),
      });
    expect(notALink).toThrow("is not a symlink");
    expect(fs.current()).toBe("/old/Paseo.app");
  });

  it("restores the previous target when the re-link fails", () => {
    const fs = fakeFs("/Applications/Paseo.app", "/old/Paseo.app");
    const failed = () =>
      repointApplicationsLink({
        target: "/broken/target",
        lstat: fs.lstat,
        readlink: fs.readlink,
        unlink: fs.unlink,
        symlink: fs.symlink,
      });
    expect(failed).toThrow("EACCES");
    expect(fs.current()).toBe("/old/Paseo.app");
  });
});
