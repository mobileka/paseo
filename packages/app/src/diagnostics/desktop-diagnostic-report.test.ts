import { describe, expect, test } from "vitest";
import {
  collectDesktopDiagnosticSections,
  type DesktopDiagnosticSources,
} from "./desktop-diagnostic-report";

function makeSources(): DesktopDiagnosticSources {
  return {
    getSandboxDiagnostics: async () => ({ enabled: true, reason: "user namespaces available" }),
    getStatus: async () => ({
      serverId: "server-1",
      status: "running",
      listen: "127.0.0.1:6767",
      hostname: "host",
      pid: 4242,
      home: "/paseo/home",
      version: "1.2.3",
      desktopManaged: true,
      ownedByDesktop: true,
      startedAt: "2026-01-01T00:00:00.000Z",
      error: null,
    }),
    getDaemonLogs: async () => ({
      logPath: "/paseo/home/daemon.log",
      contents: "daemon line one\ndaemon line two",
    }),
    getAppLogs: async () => ({
      logPath: "/logs/Paseo/main.log",
      contents: "[login-shell-env] start\n[login-shell-env] failed",
    }),
    getUpdateDiagnostics: async () => ({
      platform: "darwin",
      home: "/paseo/home",
      buildsDir: "/paseo/home/builds",
      runningBuildSha: "0123456789abcdef",
      builtAt: "2026-09-12T09:00:00Z",
      stateFile: {
        path: "/paseo/home/builds/state.json",
        contents: '{"latest":{"commit":"abcdef1234567890"}}',
        error: null,
      },
      appLink: {
        path: "/Applications/Paseo.app",
        isSymlink: true,
        target: "/paseo/home/builds/0.9.0_abcdef1/Paseo.app",
        error: null,
      },
    }),
  };
}

describe("desktop diagnostic report", () => {
  test("starts desktop diagnostic requests together", async () => {
    const calls: string[] = [];
    let releaseAppLogs: () => void = () => {};
    const appLogGate = new Promise<void>((resolve) => {
      releaseAppLogs = resolve;
    });
    const sources: DesktopDiagnosticSources = {
      ...makeSources(),
      getStatus: async () => {
        calls.push("status");
        return makeSources().getStatus();
      },
      getDaemonLogs: async () => {
        calls.push("daemonLogs");
        return makeSources().getDaemonLogs();
      },
      getAppLogs: async () => {
        calls.push("appLogs");
        await appLogGate;
        return makeSources().getAppLogs();
      },
      getUpdateDiagnostics: async () => {
        calls.push("update");
        return makeSources().getUpdateDiagnostics();
      },
    };

    const resultPromise = collectDesktopDiagnosticSections(sources);

    expect(calls).toEqual(["status", "daemonLogs", "appLogs", "update"]);
    releaseAppLogs();
    await expect(resultPromise).resolves.toMatchObject({ status: "done" });
  });

  test("includes local update diagnostics", async () => {
    const result = await collectDesktopDiagnosticSections(makeSources());
    const report = result.sections.join("\n\n");

    expect(result.status).toBe("done");
    expect(report).toContain("  Log path: /paseo/home/daemon.log");
    expect(report).toContain("  App log path: /logs/Paseo/main.log");
    expect(report).toContain("Desktop daemon log tail\n  daemon line one\n  daemon line two");
    expect(report).toContain(
      "Desktop app log tail\n  [login-shell-env] start\n  [login-shell-env] failed",
    );
    expect(report.indexOf("Desktop app log tail")).toBeGreaterThan(
      report.indexOf("Desktop daemon log tail"),
    );
    expect(report).toContain("Local updates\n  Platform: darwin");
    expect(report).toContain("  Base directory: /paseo/home");
    expect(report).toContain("  Builds directory: /paseo/home/builds");
    expect(report).toContain("  Running build: 0123456789abcdef");
    expect(report).toContain("Update state file");
    expect(report).toContain('{"latest":{"commit":"abcdef1234567890"}}');
    expect(report).toContain("/paseo/home/builds/0.9.0_abcdef1/Paseo.app");
  });

  test("includes the Electron main-process log after the daemon log", async () => {
    const result = await collectDesktopDiagnosticSections(makeSources());
    const report = result.sections.join("\n\n");

    expect(result.status).toBe("done");
    expect(report).toContain("  Log path: /paseo/home/daemon.log");
    expect(report).toContain("  App log path: /logs/Paseo/main.log");
    expect(report).toContain("Desktop daemon log tail\n  daemon line one\n  daemon line two");
    expect(report).toContain(
      "Desktop app log tail\n  [login-shell-env] start\n  [login-shell-env] failed",
    );
    expect(report.indexOf("Desktop app log tail")).toBeGreaterThan(
      report.indexOf("Desktop daemon log tail"),
    );
    expect(report).toContain("Local updates\n  Platform: darwin");
    expect(report).toContain("  App link: /paseo/home/builds/0.9.0_abcdef1/Paseo.app");
    expect(report).toContain("Update state file");
    expect(report).toContain('{"latest":{"commit":"abcdef1234567890"}}');
  });

  test("keeps daemon diagnostics when the Electron app log fails", async () => {
    const sources = {
      ...makeSources(),
      getAppLogs: async () => {
        throw new Error("app log unavailable");
      },
    };

    const result = await collectDesktopDiagnosticSections(sources);
    const report = result.sections.join("\n\n");

    expect(result.status).toBe("failed");
    expect(report).toContain("Desktop daemon log tail\n  daemon line one\n  daemon line two");
    expect(report).toContain("Desktop app log tail\n  Error: app log unavailable");
  });
});

test("reports sandbox degradation and its reason even if daemon diagnostics fail", async () => {
  const result = await collectDesktopDiagnosticSections({
    ...makeSources(),
    getStatus: async () => {
      throw new Error("daemon unavailable");
    },
    getSandboxDiagnostics: async () => ({
      enabled: false,
      reason: "user namespaces unavailable; no usable SUID helper",
    }),
  });
  expect(result.sections.join("\n")).toContain(
    "Chromium sandbox\n  State: Disabled\n  Reason: user namespaces unavailable; no usable SUID helper",
  );
  expect(result.status).toBe("failed");
});
