import { describe, expect, it, vi } from "vitest";
import { createLocalAppUpdateService, type LocalAppUpdateDeps } from "./local-app-update-service";
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

interface DepsOverrides {
  environment?: Partial<LocalAppUpdateDeps["environment"]>;
  state?: LocalUpdateState | null;
  link?: ApplicationsLinkStatus;
}

function makeDeps(overrides: DepsOverrides = {}): LocalAppUpdateDeps {
  return {
    environment: {
      isPackaged: true,
      platform: "darwin",
      buildMetadata: RUNNING_BUILD,
      ...overrides.environment,
    },
    buildsDir: "/fake/builds",
    paseoHome: "/fake/home",
    io: {
      readState: () => (overrides.state === undefined ? STAGED_STATE : overrides.state),
      readDetails: () => ({ notes: "## [0.9.0]", localChanges: "- feat: thing (abcdef1)" }),
      readChangelog: () => STAGED_CHANGELOG,
      getLinkStatus: () => overrides.link ?? OK_LINK,
    },
    repointLink: vi.fn(() => true),
    relaunch: vi.fn(),
    quit: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn() },
  };
}

describe("createLocalAppUpdateService", () => {
  it("is disabled for unpackaged runs", () => {
    const service = createLocalAppUpdateService(makeDeps({ environment: { isPackaged: false } }));
    expect(service.isEnabled()).toBe(false);
    expect(service.checkForAppUpdate({ currentVersion: "0.8.0" }).hasUpdate).toBe(false);
  });

  it("is disabled without a build sha (stock bundle)", () => {
    const service = createLocalAppUpdateService(
      makeDeps({ environment: { buildMetadata: { buildSha: null, builtAt: null } } }),
    );
    expect(service.isEnabled()).toBe(false);
  });

  it("is disabled off macOS", () => {
    const service = createLocalAppUpdateService(makeDeps({ environment: { platform: "linux" } }));
    expect(service.isEnabled()).toBe(false);
  });

  it("reports the staged build with notes when it differs from the running commit", () => {
    const service = createLocalAppUpdateService(makeDeps());
    expect(service.checkForAppUpdate({ currentVersion: "0.8.0" })).toEqual({
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

  it("reports no update when the running commit matches", () => {
    const service = createLocalAppUpdateService(
      makeDeps({
        state: {
          ...STAGED_STATE,
          latest: { ...STAGED_STATE.latest, commit: RUNNING_BUILD.buildSha },
        },
      }),
    );
    expect(service.checkForAppUpdate({ currentVersion: "0.8.0" }).hasUpdate).toBe(false);
  });

  it("reports no update when the staged build is not newer", () => {
    const service = createLocalAppUpdateService(
      makeDeps({
        state: {
          ...STAGED_STATE,
          latest: { ...STAGED_STATE.latest, builtAt: "2026-08-01T00:00:00Z" },
        },
      }),
    );
    expect(service.checkForAppUpdate({ currentVersion: "0.8.0" }).hasUpdate).toBe(false);
  });

  it("returns the local changelog when the channel is enabled", () => {
    const service = createLocalAppUpdateService(makeDeps());
    expect(service.getChangelog()).toEqual(STAGED_CHANGELOG);
  });

  it("returns no changelog for a stock bundle", () => {
    const service = createLocalAppUpdateService(
      makeDeps({ environment: { buildMetadata: { buildSha: null, builtAt: null } } }),
    );
    expect(service.getChangelog()).toEqual([]);
  });

  it("flags an unusable /Applications link instead of a clickable dead end", () => {
    const service = createLocalAppUpdateService(
      makeDeps({
        link: {
          isSymlink: false,
          target: null,
          error:
            "/Applications/Paseo.app is not a symlink. Install the fork build once by linking it into /Applications.",
        },
      }),
    );
    const check = service.checkForAppUpdate({ currentVersion: "0.8.0" });
    expect(check.hasUpdate).toBe(true);
    expect(check.readyToInstall).toBe(false);
    expect(check.errorMessage).toContain("is not a symlink");
  });

  it("applies the update: stop daemon, repoint link, relaunch, quit", async () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps();
      const service = createLocalAppUpdateService(deps);
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

  it("refuses to install when the link is unusable", async () => {
    const deps = makeDeps({ link: { isSymlink: false, target: null, error: "not a symlink" } });
    const service = createLocalAppUpdateService(deps);
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
    const service = createLocalAppUpdateService(deps);
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
