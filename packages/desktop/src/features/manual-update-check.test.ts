import { describe, expect, it, vi } from "vitest";
import type { AppUpdateCheckResult } from "./app-update-service";
import {
  createManualUpdateCheck,
  formatManualUpdateOutcome,
  type ManualUpdateCheckMessageBox,
} from "./manual-update-check";

function checkResult(overrides: Partial<AppUpdateCheckResult> = {}): AppUpdateCheckResult {
  return {
    hasUpdate: false,
    readyToInstall: false,
    currentVersion: "0.8.0-personal.3",
    latestVersion: null,
    body: null,
    localChanges: null,
    currentCommit: "80c0a1f",
    targetCommit: null,
    date: null,
    errorMessage: null,
    ...overrides,
  };
}

describe("formatManualUpdateOutcome", () => {
  it("reports an available update", () => {
    expect(formatManualUpdateOutcome(checkResult({ hasUpdate: true }))).toEqual({ kind: "update" });
  });

  it("reports the running version when up to date", () => {
    expect(formatManualUpdateOutcome(checkResult())).toEqual({
      kind: "up-to-date",
      version: "0.8.0-personal.3",
    });
  });

  it("reports the check error", () => {
    expect(formatManualUpdateOutcome(checkResult({ errorMessage: "GitHub timed out." }))).toEqual({
      kind: "error",
      message: "GitHub timed out.",
    });
  });
});

describe("createManualUpdateCheck", () => {
  it("notifies the renderer instead of showing a dialog when an update exists", async () => {
    const notifyRenderer = vi.fn();
    const showMessageBox = vi.fn(async (_input: ManualUpdateCheckMessageBox) => undefined);
    const run = createManualUpdateCheck({
      check: async () => checkResult({ hasUpdate: true }),
      notifyRenderer,
      showMessageBox,
    });

    await run();

    expect(notifyRenderer).toHaveBeenCalledTimes(1);
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it("shows the running version when up to date", async () => {
    const showMessageBox = vi.fn(async (_input: ManualUpdateCheckMessageBox) => undefined);
    const run = createManualUpdateCheck({
      check: async () => checkResult(),
      notifyRenderer: vi.fn(),
      showMessageBox,
    });

    await run();

    expect(showMessageBox).toHaveBeenCalledWith({
      type: "info",
      title: "Paseo is up to date",
      message: "Version 0.8.0-personal.3",
    });
  });

  it("shows the error message when the check reports one", async () => {
    const showMessageBox = vi.fn(async (_input: ManualUpdateCheckMessageBox) => undefined);
    const run = createManualUpdateCheck({
      check: async () => checkResult({ errorMessage: "GitHub update check timed out." }),
      notifyRenderer: vi.fn(),
      showMessageBox,
    });

    await run();

    expect(showMessageBox).toHaveBeenCalledWith({
      type: "error",
      title: "Couldn't check for updates",
      message: "GitHub update check timed out.",
    });
  });

  it("shows a thrown check error", async () => {
    const showMessageBox = vi.fn(async (_input: ManualUpdateCheckMessageBox) => undefined);
    const run = createManualUpdateCheck({
      check: async () => {
        throw new Error("offline");
      },
      notifyRenderer: vi.fn(),
      showMessageBox,
    });

    await run();

    expect(showMessageBox).toHaveBeenCalledWith({
      type: "error",
      title: "Couldn't check for updates",
      message: "offline",
    });
  });
});
