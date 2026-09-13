import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGithubUpdateSource } from "./github-app-update";
import type { GithubFetch, GithubFetchResponse } from "./github-releases";

const COMMIT = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const METADATA_URL = "https://example.test/build.json";

function releaseJson() {
  return {
    tag_name: "personal-20260914-1000-bbbbbbb",
    name: "Paseo personal bbbbbbb",
    body: "notes",
    published_at: "2026-09-14T10:00:00Z",
    draft: false,
    assets: [
      {
        name: "build.json",
        browser_download_url: METADATA_URL,
        size: 100,
      },
      {
        name: "Paseo-arm64.zip",
        browser_download_url: "https://example.test/Paseo-arm64.zip",
        size: 100,
      },
    ],
  };
}

function metadataJson() {
  return {
    version: "0.8.0",
    commit: COMMIT,
    builtAt: "2026-09-14T10:00:00Z",
    notes: "## 0.8.0",
    localChanges: "- fix: thing (bbbbbbb)",
    sha256: null,
  };
}

function response(
  body: unknown,
  { status = 200, headers = {} }: { status?: number; headers?: Record<string, string> } = {},
): GithubFetchResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

const tempDirs: string[] = [];

function makeTempBuildsDir(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "paseo-github-source-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("createGithubUpdateSource", () => {
  it("resolves a candidate and reports diagnostics", async () => {
    const fetchImpl = vi.fn<GithubFetch>(async (url) => {
      if (url === METADATA_URL) return response(metadataJson());
      return response([releaseJson()], { headers: { etag: "etag-1" } });
    });
    const source = createGithubUpdateSource({
      buildsDir: makeTempBuildsDir(),
      fetchImpl,
      now: () => "2026-09-14T11:00:00Z",
      installIo: { download: vi.fn(), extractZip: vi.fn(), smokeTest: vi.fn() },
    });

    const result = await source.fetchCandidate();
    expect(result.errorMessage).toBeNull();
    expect(result.candidate?.tag).toBe("personal-20260914-1000-bbbbbbb");
    expect(source.getDiagnostics()).toEqual({
      repo: "mobileka/paseo",
      lastCheckedAt: "2026-09-14T11:00:00Z",
      latestTag: "personal-20260914-1000-bbbbbbb",
      latestCommit: COMMIT,
      lastError: null,
      hasEtag: true,
    });
  });

  it("returns the cached candidate on a 304 and sends the etag", async () => {
    let listCalls = 0;
    const fetchImpl = vi.fn<GithubFetch>(async (url, init) => {
      if (url === METADATA_URL) return response(metadataJson());
      listCalls += 1;
      if (listCalls === 1) return response([releaseJson()], { headers: { etag: "etag-1" } });
      expect(init?.headers?.["if-none-match"]).toBe("etag-1");
      return response(null, { status: 304 });
    });
    const source = createGithubUpdateSource({
      buildsDir: makeTempBuildsDir(),
      fetchImpl,
      installIo: { download: vi.fn(), extractZip: vi.fn(), smokeTest: vi.fn() },
    });

    await source.fetchCandidate();
    const second = await source.fetchCandidate();
    expect(second.candidate?.commit).toBe(COMMIT);
    expect(second.errorMessage).toBeNull();
  });

  it("maps fetch failures to an error message", async () => {
    const fetchImpl = vi.fn<GithubFetch>(async () => {
      throw new Error("offline");
    });
    const source = createGithubUpdateSource({
      buildsDir: makeTempBuildsDir(),
      fetchImpl,
      installIo: { download: vi.fn(), extractZip: vi.fn(), smokeTest: vi.fn() },
    });

    const result = await source.fetchCandidate();
    expect(result).toEqual({ candidate: null, errorMessage: "offline" });
    expect(source.getDiagnostics().lastError).toBe("offline");
  });
});
