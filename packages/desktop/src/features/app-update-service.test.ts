import { describe, expect, it, vi } from "vitest";
import { createAppUpdateService, type AppUpdateDeps } from "./app-update-service";
import type { GithubUpdateSource } from "./github-app-update";
import type { GithubReleaseCandidate } from "./github-releases";
import type {
  ApplicationsLinkStatus,
  LocalChangelogEntry,
  LocalUpdateState,
} from "./local-updates";

const RUNNING_BUILD = { buildSha: "0000000000000000", builtAt: "2026-09-01T09:00:00Z" };

const STAGED_STATE: LocalUpdateState = {
  latest: {
    folder: "0.9.0_abcdef12",
    commit: "abcdef1234567890",
    version: "0.9.0",
    builtAt: "2026-09-12T10:00:00Z",
    appPath: "/fake/builds/0.9.0_abcdef12/Paseo.app",
  },
  previous: null,
  updatedAt: "2026-09-12T10:00:00Z",
};

const OK_LINK: ApplicationsLinkStatus = {
  isSymlink: true,
  target: "/previous/Paseo.app",
  error: null,
};

const STAGED_CHANGELOG: LocalChangelogEntry[] = [
  {
    version: "0.9.0",
    commit: "abcdef1234567890",
    builtAt: "2026-09-12T10:00:00Z",
    notes: "## [0.9.0]\n\n- feat: thing (abcdef1)",
    localChanges: "- feat: thing (abcdef1)",
    isRunning: false,
  },
];

const GITHUB_CANDIDATE: GithubReleaseCandidate = {
  tag: "personal-20260914-1000-bbbbbbb",
  version: "0.8.0",
  commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  builtAt: "2026-09-14T10:00:00Z",
  notes: "## 0.8.0\n\n- fix: remote thing (bbbbbbb)",
  localChanges: "- fix: remote thing (bbbbbbb)",
  publishedAt: "2026-09-14T10:01:00Z",
  zipAsset: {
    name: "Paseo-arm64.zip",
    downloadUrl: "https://example.test/Paseo-arm64.zip",
    size: 100,
  },
  metadataAsset: {
    name: "build.json",
    downloadUrl: "https://example.test/build.json",
    size: 100,
  },
  sha256: "a".repeat(64),
};

const STAGED_GITHUB_BUILD = {
  appPath: "/fake/builds/0.8.0_bbbbbbb/Paseo.app",
  folder: "0.8.0_bbbbbbb",
  version: "0.8.0",
  commit: GITHUB_CANDIDATE.commit,
};

function makeGithubSource(
  overrides: {
    candidate?: GithubReleaseCandidate | null;
    errorMessage?: string | null;
    staged?: typeof STAGED_GITHUB_BUILD;
  } = {},
): GithubUpdateSource {
  return {
    fetchCandidate: vi.fn(async () => ({
      candidate: overrides.candidate === undefined ? null : overrides.candidate,
      errorMessage: overrides.errorMessage ?? null,
    })),
    install: vi.fn(async () => overrides.staged ?? STAGED_GITHUB_BUILD),
    getDiagnostics: () => ({
      repo: "mobileka/paseo",
      lastCheckedAt: null,
      latestTag: null,
      latestCommit: null,
      lastError: null,
      hasEtag: false,
    }),
  };
}

interface DepsOverrides {
  environment?: Partial<AppUpdateDeps["environment"]>;
  state?: LocalUpdateState | null;
  link?: ApplicationsLinkStatus;
  github?: GithubUpdateSource;
}

function makeDeps(overrides: DepsOverrides = {}): AppUpdateDeps {
  return {
    environment: {
      isPackaged: true,
      platform: "darwin",
      buildMetadata: RUNNING_BUILD,
      ...overrides.environment,
    },
    buildsDir: "/fake/builds",
    paseoHome: "/fake/home",
    local: {
      readState: () => (overrides.state === undefined ? STAGED_STATE : overrides.state),
      readDetails: () => ({ notes: "## [0.9.0]", localChanges: "- feat: thing (abcdef1)" }),
      readChangelog: () => STAGED_CHANGELOG,
      getLinkStatus: () => overrides.link ?? OK_LINK,
    },
    github: overrides.github ?? makeGithubSource(),
    repointLink: vi.fn(() => true),
    relaunch: vi.fn(),
    quit: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn() },
  };
}

describe("createAppUpdateService", () => {
  it("is disabled for unpackaged runs", async () => {
    const service = createAppUpdateService(makeDeps({ environment: { isPackaged: false } }));
    expect(service.isEnabled()).toBe(false);
    expect((await service.checkForAppUpdate({ currentVersion: "0.8.0" })).hasUpdate).toBe(false);
  });

  it("is disabled without a build sha (stock bundle)", () => {
    const service = createAppUpdateService(
      makeDeps({ environment: { buildMetadata: { buildSha: null, builtAt: null } } }),
    );
    expect(service.isEnabled()).toBe(false);
  });

  it("is disabled off macOS", () => {
    const service = createAppUpdateService(makeDeps({ environment: { platform: "linux" } }));
    expect(service.isEnabled()).toBe(false);
  });

  it("reports the staged build with notes when it differs from the running commit", async () => {
    const service = createAppUpdateService(makeDeps());
    expect(await service.checkForAppUpdate({ currentVersion: "0.8.0" })).toEqual({
      hasUpdate: true,
      readyToInstall: true,
      currentVersion: "0.8.0",
      latestVersion: "0.9.0",
      body: "## [0.9.0]",
      localChanges: "- feat: thing (abcdef1)",
      currentCommit: "0000000",
      targetCommit: "abcdef1",
      date: "2026-09-12T10:00:00Z",
      errorMessage: null,
    });
  });

  it("reports the GitHub release when it is newer than the staged build", async () => {
    const service = createAppUpdateService(
      makeDeps({ github: makeGithubSource({ candidate: GITHUB_CANDIDATE }) }),
    );
    expect(await service.checkForAppUpdate({ currentVersion: "0.8.0" })).toEqual({
      hasUpdate: true,
      readyToInstall: true,
      currentVersion: "0.8.0",
      latestVersion: "0.8.0",
      body: "## 0.8.0\n\n- fix: remote thing (bbbbbbb)",
      localChanges: "- fix: remote thing (bbbbbbb)",
      currentCommit: "0000000",
      targetCommit: "bbbbbbb",
      date: "2026-09-14T10:00:00Z",
      errorMessage: null,
    });
  });

  it("prefers the staged build when it is newer than the release", async () => {
    const service = createAppUpdateService(
      makeDeps({
        github: makeGithubSource({
          candidate: { ...GITHUB_CANDIDATE, builtAt: "2026-09-11T10:00:00Z" },
        }),
      }),
    );
    const result = await service.checkForAppUpdate({ currentVersion: "0.8.0" });
    expect(result.latestVersion).toBe("0.9.0");
    expect(result.targetCommit).toBe("abcdef1");
  });

  it("keeps a staged update when the GitHub check fails", async () => {
    const service = createAppUpdateService(
      makeDeps({ github: makeGithubSource({ errorMessage: "GitHub is down." }) }),
    );
    const result = await service.checkForAppUpdate({ currentVersion: "0.8.0" });
    expect(result.hasUpdate).toBe(true);
    expect(result.errorMessage).toBeNull();
  });

  it("surfaces a GitHub check failure when nothing else is available", async () => {
    const service = createAppUpdateService(
      makeDeps({
        state: null,
        github: makeGithubSource({ errorMessage: "GitHub is down." }),
      }),
    );
    const result = await service.checkForAppUpdate({ currentVersion: "0.8.0" });
    expect(result.hasUpdate).toBe(false);
    expect(result.errorMessage).toBe("GitHub is down.");
  });

  it("reports no update when the running commit matches", async () => {
    const service = createAppUpdateService(
      makeDeps({
        state: {
          ...STAGED_STATE,
          latest: { ...STAGED_STATE.latest, commit: RUNNING_BUILD.buildSha },
        },
      }),
    );
    expect((await service.checkForAppUpdate({ currentVersion: "0.8.0" })).hasUpdate).toBe(false);
  });

  it("reports no update when the staged build is not newer", async () => {
    const service = createAppUpdateService(
      makeDeps({
        state: {
          ...STAGED_STATE,
          latest: { ...STAGED_STATE.latest, builtAt: "2026-08-01T00:00:00Z" },
        },
      }),
    );
    expect((await service.checkForAppUpdate({ currentVersion: "0.8.0" })).hasUpdate).toBe(false);
  });

  it("returns the local changelog when the channel is enabled", () => {
    const service = createAppUpdateService(makeDeps());
    expect(service.getChangelog()).toEqual(STAGED_CHANGELOG);
  });

  it("prepends a pending GitHub release to the changelog", async () => {
    const service = createAppUpdateService(
      makeDeps({ github: makeGithubSource({ candidate: GITHUB_CANDIDATE }) }),
    );
    await service.checkForAppUpdate({ currentVersion: "0.8.0" });
    expect(service.getChangelog()).toEqual([
      {
        version: "0.8.0",
        commit: GITHUB_CANDIDATE.commit,
        builtAt: "2026-09-14T10:00:00Z",
        notes: "## 0.8.0\n\n- fix: remote thing (bbbbbbb)",
        localChanges: "- fix: remote thing (bbbbbbb)",
        isRunning: false,
      },
      ...STAGED_CHANGELOG,
    ]);
  });

  it("does not duplicate a staged GitHub build in the changelog", async () => {
    const service = createAppUpdateService(
      makeDeps({
        github: makeGithubSource({
          candidate: { ...GITHUB_CANDIDATE, commit: "abcdef1234567890" },
        }),
      }),
    );
    await service.checkForAppUpdate({ currentVersion: "0.8.0" });
    expect(service.getChangelog()).toEqual(STAGED_CHANGELOG);
  });

  it("returns no changelog for a stock bundle", () => {
    const service = createAppUpdateService(
      makeDeps({ environment: { buildMetadata: { buildSha: null, builtAt: null } } }),
    );
    expect(service.getChangelog()).toEqual([]);
  });

  it("includes GitHub diagnostics", () => {
    const service = createAppUpdateService(
      makeDeps({ github: makeGithubSource({ candidate: GITHUB_CANDIDATE }) }),
    );
    expect(service.getUpdateDiagnostics().github).toEqual({
      repo: "mobileka/paseo",
      lastCheckedAt: null,
      latestTag: null,
      latestCommit: null,
      lastError: null,
      hasEtag: false,
    });
  });

  it("flags an unusable /Applications link instead of a clickable dead end", async () => {
    const service = createAppUpdateService(
      makeDeps({
        link: {
          isSymlink: false,
          target: null,
          error:
            "/Applications/Paseo.app is not a symlink. Install the fork build once by linking it into /Applications.",
        },
      }),
    );
    const check = await service.checkForAppUpdate({ currentVersion: "0.8.0" });
    expect(check.hasUpdate).toBe(true);
    expect(check.readyToInstall).toBe(false);
    expect(check.errorMessage).toContain("is not a symlink");
  });

  it("applies a local update: stop daemon, repoint link, relaunch, quit", async () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps();
      const service = createAppUpdateService(deps);
      await service.checkForAppUpdate({ currentVersion: "0.8.0" });
      const stopDaemon = vi.fn(async () => undefined);
      const result = await service.installAppUpdate({ currentVersion: "0.8.0", stopDaemon });
      expect(result.installed).toBe(true);
      expect(result.version).toBe("0.9.0");
      expect(stopDaemon).toHaveBeenCalledTimes(1);
      expect(deps.repointLink).toHaveBeenCalledWith("/fake/builds/0.9.0_abcdef12/Paseo.app");
      vi.advanceTimersByTime(0);
      expect(deps.relaunch).toHaveBeenCalledWith("/Applications/Paseo.app/Contents/MacOS/Paseo");
      expect(deps.quit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("installs a GitHub release through the GitHub source", async () => {
    vi.useFakeTimers();
    try {
      const github = makeGithubSource({ candidate: GITHUB_CANDIDATE });
      const deps = makeDeps({ github });
      const service = createAppUpdateService(deps);
      await service.checkForAppUpdate({ currentVersion: "0.8.0" });
      const stopDaemon = vi.fn(async () => undefined);
      const result = await service.installAppUpdate({ currentVersion: "0.8.0", stopDaemon });
      expect(result.installed).toBe(true);
      expect(result.version).toBe("0.8.0");
      expect(github.install).toHaveBeenCalledWith(GITHUB_CANDIDATE);
      expect(deps.repointLink).toHaveBeenCalledWith("/fake/builds/0.8.0_bbbbbbb/Paseo.app");
      vi.advanceTimersByTime(0);
      expect(deps.quit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a GitHub install failure without touching the link", async () => {
    const github = makeGithubSource({ candidate: GITHUB_CANDIDATE });
    github.install = vi.fn(async () => {
      throw new Error("checksum mismatch");
    });
    const deps = makeDeps({ github });
    const service = createAppUpdateService(deps);
    await service.checkForAppUpdate({ currentVersion: "0.8.0" });
    const result = await service.installAppUpdate({
      currentVersion: "0.8.0",
      stopDaemon: vi.fn(async () => undefined),
    });
    expect(result.installed).toBe(false);
    expect(result.message).toBe("checksum mismatch");
    expect(deps.repointLink).not.toHaveBeenCalled();
  });

  it("refuses to install when the link is unusable", async () => {
    const deps = makeDeps({ link: { isSymlink: false, target: null, error: "not a symlink" } });
    const service = createAppUpdateService(deps);
    await service.checkForAppUpdate({ currentVersion: "0.8.0" });
    const result = await service.installAppUpdate({
      currentVersion: "0.8.0",
      stopDaemon: vi.fn(async () => undefined),
    });
    expect(result.installed).toBe(false);
    expect(result.message).toBe("not a symlink");
    expect(deps.repointLink).not.toHaveBeenCalled();
  });

  it("reports a repoint failure instead of quitting into a broken state", async () => {
    const deps = makeDeps();
    deps.repointLink = vi.fn(() => {
      throw new Error("EACCES");
    });
    const service = createAppUpdateService(deps);
    await service.checkForAppUpdate({ currentVersion: "0.8.0" });
    const result = await service.installAppUpdate({
      currentVersion: "0.8.0",
      stopDaemon: vi.fn(async () => undefined),
    });
    expect(result.installed).toBe(false);
    expect(result.message).toBe("EACCES");
    expect(deps.relaunch).not.toHaveBeenCalled();
    expect(deps.quit).not.toHaveBeenCalled();
  });
});
