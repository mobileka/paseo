import { afterEach, describe, expect, it, vi } from "vitest";

async function loadModuleForPlatform(platform: "web" | "ios" | "android") {
  vi.resetModules();
  vi.doMock("react-native", () => ({ Platform: { OS: platform } }));
  return import("./desktop-updates");
}

describe("desktop-updates helpers", () => {
  afterEach(() => {
    vi.doUnmock("react-native");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("normalizes versions for app-daemon comparisons", async () => {
    const { normalizeVersionForComparison } = await loadModuleForPlatform("web");

    expect(normalizeVersionForComparison(" v0.1.15 ")).toBe("0.1.15");
    expect(normalizeVersionForComparison("0.1.15")).toBe("0.1.15");
    expect(normalizeVersionForComparison(null)).toBeNull();
  });

  it("detects version mismatch after normalization", async () => {
    const { isVersionMismatch } = await loadModuleForPlatform("web");

    expect(isVersionMismatch("v0.1.15", "0.1.15")).toBe(false);
    expect(isVersionMismatch("0.1.15", "0.1.16")).toBe(true);
    expect(isVersionMismatch("0.1.15", null)).toBe(false);
  });

  it("formats display versions with v prefix and unavailable fallback", async () => {
    const { formatVersionWithPrefix } = await loadModuleForPlatform("web");

    expect(formatVersionWithPrefix("0.2.0")).toBe("v0.2.0");
    expect(formatVersionWithPrefix("v0.2.0")).toBe("v0.2.0");
    expect(formatVersionWithPrefix(null)).toBe("\u2014");
  });

  it("appends the short commit to the build label", async () => {
    const { formatBuildLabel, normalizeBuildCommit } = await loadModuleForPlatform("web");

    expect(formatBuildLabel("0.8.0", "4eea92a274448fea1fd8b29e03ef560fd25dbf07")).toBe(
      "v0.8.0 \u00b7 4eea92a",
    );
    expect(formatBuildLabel("0.8.0", null)).toBe("v0.8.0");
    expect(formatBuildLabel(null, "4eea92a")).toBe("4eea92a");
    expect(normalizeBuildCommit(" 4EEA92A27444 ")).toBe("4eea92a");
    expect(normalizeBuildCommit("")).toBeNull();
  });

  it("parses valid local daemon version result", async () => {
    const { parseLocalDaemonVersionResult } = await loadModuleForPlatform("web");

    expect(parseLocalDaemonVersionResult({ version: "0.1.15", error: null })).toEqual({
      version: "0.1.15",
      error: null,
    });
  });

  it("parses local daemon version error result", async () => {
    const { parseLocalDaemonVersionResult } = await loadModuleForPlatform("web");

    expect(
      parseLocalDaemonVersionResult({ version: null, error: "paseo command not found in PATH" }),
    ).toEqual({
      version: null,
      error: "paseo command not found in PATH",
    });
  });

  it("parses unexpected local daemon version result", async () => {
    const { parseLocalDaemonVersionResult } = await loadModuleForPlatform("web");

    expect(parseLocalDaemonVersionResult(null)).toEqual({
      version: null,
      error: "Unexpected response from version check.",
    });

    expect(parseLocalDaemonVersionResult("not an object")).toEqual({
      version: null,
      error: "Unexpected response from version check.",
    });
  });

  it("trims whitespace in parsed version", async () => {
    const { parseLocalDaemonVersionResult } = await loadModuleForPlatform("web");

    expect(parseLocalDaemonVersionResult({ version: " 0.1.15 ", error: null })).toEqual({
      version: "0.1.15",
      error: null,
    });
  });

  it("parses local changelog entries defensively", async () => {
    const { parseLocalChangelog } = await loadModuleForPlatform("web");

    expect(
      parseLocalChangelog([
        {
          version: "0.9.0",
          commit: "abcdef1234567890",
          builtAt: "2026-09-12T10:00:00Z",
          notes: "## [0.9.0]\n\n- new thing",
          localChanges: "- feat: thing (abcdef1)",
          isRunning: true,
        },
        { version: "0.8.0" },
        { noVersion: true },
        "not an object",
      ]),
    ).toEqual([
      {
        version: "0.9.0",
        commit: "abcdef1234567890",
        builtAt: "2026-09-12T10:00:00Z",
        notes: "## [0.9.0]\n\n- new thing",
        localChanges: "- feat: thing (abcdef1)",
        isRunning: true,
      },
      {
        version: "0.8.0",
        commit: "",
        builtAt: "",
        notes: null,
        localChanges: null,
        isRunning: false,
      },
    ]);
  });

  it("returns no entries for a non-array response", async () => {
    const { parseLocalChangelog } = await loadModuleForPlatform("web");

    expect(parseLocalChangelog(null)).toEqual([]);
    expect(parseLocalChangelog({ entries: [] })).toEqual([]);
  });

  it("parses desktop update download progress", async () => {
    const { parseDesktopAppUpdateProgress } = await loadModuleForPlatform("web");

    expect(
      parseDesktopAppUpdateProgress({ percent: 42, receivedBytes: 100, totalBytes: 250 }),
    ).toEqual({ percent: 42, receivedBytes: 100, totalBytes: 250 });
    expect(parseDesktopAppUpdateProgress({ receivedBytes: 100, totalBytes: 250 })).toEqual({
      percent: null,
      receivedBytes: 100,
      totalBytes: 250,
    });
    expect(
      parseDesktopAppUpdateProgress({ percent: 150, receivedBytes: 250, totalBytes: 250 }),
    ).toEqual({ percent: 100, receivedBytes: 250, totalBytes: 250 });
  });

  it("rejects malformed desktop update progress", async () => {
    const { parseDesktopAppUpdateProgress } = await loadModuleForPlatform("web");

    expect(parseDesktopAppUpdateProgress(null)).toBeNull();
    expect(parseDesktopAppUpdateProgress({ percent: 10 })).toBeNull();
    expect(parseDesktopAppUpdateProgress({ receivedBytes: Number.NaN, totalBytes: 10 })).toBeNull();
  });
});
