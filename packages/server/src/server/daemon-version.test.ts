import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DaemonVersionResolutionError, resolveDaemonVersion } from "./daemon-version.js";

const createdDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "paseo-daemon-version-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveDaemonVersion", () => {
  it("resolves server version by walking up to @getpaseo/server package.json", () => {
    const root = createTempDir();
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "@getpaseo/server", version: "9.8.7" }),
      "utf8",
    );
    const nestedDir = path.join(root, "dist", "server");
    mkdirSync(nestedDir, { recursive: true });

    const moduleUrl = pathToFileURL(path.join(nestedDir, "index.js")).href;
    expect(resolveDaemonVersion(moduleUrl)).toBe("9.8.7");
  });

  it("throws when @getpaseo/server package metadata cannot be resolved", () => {
    const root = createTempDir();
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "not-getpaseo-server", version: "1.2.3" }),
      "utf8",
    );
    const nestedDir = path.join(root, "dist", "server");
    mkdirSync(nestedDir, { recursive: true });

    const moduleUrl = pathToFileURL(path.join(nestedDir, "index.js")).href;
    expect(() => resolveDaemonVersion(moduleUrl)).toThrow(DaemonVersionResolutionError);
  });

  it("throws when @getpaseo/server version is missing", () => {
    const root = createTempDir();
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "@getpaseo/server" }),
      "utf8",
    );
    const nestedDir = path.join(root, "dist", "server");
    mkdirSync(nestedDir, { recursive: true });

    const moduleUrl = pathToFileURL(path.join(nestedDir, "index.js")).href;
    expect(() => resolveDaemonVersion(moduleUrl)).toThrow(DaemonVersionResolutionError);
  });
});

describe("resolveDaemonVersion override", () => {
  const previous = process.env.PASEO_DAEMON_VERSION;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.PASEO_DAEMON_VERSION;
    } else {
      process.env.PASEO_DAEMON_VERSION = previous;
    }
  });

  it("prefers the PASEO_DAEMON_VERSION override over package metadata", () => {
    process.env.PASEO_DAEMON_VERSION = "0.8.0-personal.3";
    const moduleUrl = pathToFileURL(path.join(tmpdir(), "missing", "index.js")).href;

    expect(resolveDaemonVersion(moduleUrl)).toBe("0.8.0-personal.3");
  });

  it("ignores a blank override", () => {
    process.env.PASEO_DAEMON_VERSION = "   ";
    const root = createTempDir();
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "@getpaseo/server", version: "9.8.7" }),
      "utf8",
    );
    const nestedDir = path.join(root, "dist", "server");
    mkdirSync(nestedDir, { recursive: true });

    const moduleUrl = pathToFileURL(path.join(nestedDir, "index.js")).href;
    expect(resolveDaemonVersion(moduleUrl)).toBe("9.8.7");
  });
});
