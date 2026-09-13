import { describe, expect, it, vi } from "vitest";
import {
  createReleaseCandidate,
  fetchLatestPersonalRelease,
  GithubReleaseError,
  isPersonalReleaseTag,
  parseGithubRelease,
  parseReleaseMetadata,
  resolveLatestReleaseCandidate,
  selectLatestPersonalRelease,
  type GithubFetch,
  type GithubFetchResponse,
  type GithubRelease,
  type GithubReleaseMetadata,
} from "./github-releases";

const METADATA_URL = "https://example.test/build.json";
const ZIP_URL = "https://example.test/Paseo-arm64.zip";

function releaseAsset(name: string, downloadUrl: string, size = 100) {
  return { name, browser_download_url: downloadUrl, size };
}

function releaseJson(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: "personal-20260913-1200-abcdef1",
    name: "Paseo personal abcdef1",
    body: "release notes",
    published_at: "2026-09-13T12:00:00Z",
    draft: false,
    assets: [releaseAsset("build.json", METADATA_URL), releaseAsset("Paseo-arm64.zip", ZIP_URL)],
    ...overrides,
  };
}

function metadataJson(overrides: Record<string, unknown> = {}) {
  return {
    version: "0.8.0",
    commit: "abcdef1234567890abcdef1234567890abcdef12",
    builtAt: "2026-09-13T12:00:00Z",
    notes: "## 0.8.0",
    localChanges: "- feat: thing (abcdef1)",
    sha256: "a".repeat(64),
    ...overrides,
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

function makeRelease(overrides: Partial<GithubRelease> = {}): GithubRelease {
  return {
    tag: "personal-20260913-1200-abcdef1",
    name: "Paseo personal abcdef1",
    body: "notes",
    publishedAt: "2026-09-13T12:00:00Z",
    assets: [
      { name: "build.json", downloadUrl: METADATA_URL, size: 100 },
      { name: "Paseo-arm64.zip", downloadUrl: ZIP_URL, size: 100 },
    ],
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<GithubReleaseMetadata> = {}): GithubReleaseMetadata {
  return {
    version: "0.8.0",
    commit: "abcdef1234567890abcdef1234567890abcdef12",
    builtAt: "2026-09-13T12:00:00Z",
    notes: "## 0.8.0",
    localChanges: "- feat: thing (abcdef1)",
    sha256: "a".repeat(64),
    ...overrides,
  };
}

describe("parseGithubRelease", () => {
  it("maps a release payload", () => {
    expect(parseGithubRelease(releaseJson())).toEqual({
      tag: "personal-20260913-1200-abcdef1",
      name: "Paseo personal abcdef1",
      body: "release notes",
      publishedAt: "2026-09-13T12:00:00Z",
      assets: [
        { name: "build.json", downloadUrl: METADATA_URL, size: 100 },
        { name: "Paseo-arm64.zip", downloadUrl: ZIP_URL, size: 100 },
      ],
    });
  });

  it("drops drafts and payloads without a tag", () => {
    expect(parseGithubRelease(releaseJson({ draft: true }))).toBeNull();
    expect(parseGithubRelease(releaseJson({ tag_name: "" }))).toBeNull();
    expect(parseGithubRelease(null)).toBeNull();
  });
});

describe("parseReleaseMetadata", () => {
  it("normalizes the commit and sha", () => {
    const metadata = parseReleaseMetadata(
      metadataJson({ commit: "ABCDEF1234567890", sha256: "B".repeat(64) }),
    );
    expect(metadata?.commit).toBe("abcdef1234567890");
    expect(metadata?.sha256).toBe("b".repeat(64));
  });

  it("rejects malformed metadata", () => {
    expect(parseReleaseMetadata(metadataJson({ commit: "not-a-sha" }))).toBeNull();
    expect(parseReleaseMetadata(metadataJson({ version: "" }))).toBeNull();
    expect(parseReleaseMetadata(metadataJson({ builtAt: "" }))).toBeNull();
    expect(parseReleaseMetadata(null)).toBeNull();
  });

  it("treats a malformed sha256 as absent", () => {
    expect(parseReleaseMetadata(metadataJson({ sha256: "nope" }))?.sha256).toBeNull();
  });
});

describe("release selection", () => {
  it("recognizes only personal tags", () => {
    expect(isPersonalReleaseTag("personal-20260913-abcdef1")).toBe(true);
    expect(isPersonalReleaseTag("personal-")).toBe(false);
    expect(isPersonalReleaseTag("v0.8.0")).toBe(false);
  });

  it("picks the newest published personal release", () => {
    const older = makeRelease({
      tag: "personal-20260912-aaaaaaa",
      publishedAt: "2026-09-12T00:00:00Z",
    });
    const newer = makeRelease({
      tag: "personal-20260913-bbbbbbb",
      publishedAt: "2026-09-13T00:00:00Z",
    });
    const upstream = makeRelease({ tag: "v0.9.0", publishedAt: "2026-09-14T00:00:00Z" });
    expect(selectLatestPersonalRelease([older, upstream, newer])?.tag).toBe(
      "personal-20260913-bbbbbbb",
    );
    expect(selectLatestPersonalRelease([upstream])).toBeNull();
  });
});

describe("createReleaseCandidate", () => {
  it("requires both the zip and the metadata asset", () => {
    expect(createReleaseCandidate({ release: makeRelease(), metadata: makeMetadata() })?.tag).toBe(
      "personal-20260913-1200-abcdef1",
    );
    expect(
      createReleaseCandidate({
        release: makeRelease({ assets: [] }),
        metadata: makeMetadata(),
      }),
    ).toBeNull();
  });
});

describe("fetchLatestPersonalRelease", () => {
  it("sends the etag and handles 304", async () => {
    const fetchImpl = vi.fn<GithubFetch>(async () => response(null, { status: 304 }));
    const result = await fetchLatestPersonalRelease({ fetchImpl, etag: "abc" });
    expect(result.notModified).toBe(true);
    expect(result.etag).toBe("abc");
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(init?.headers?.["if-none-match"]).toBe("abc");
  });

  it("maps a rate limit response to a typed error", async () => {
    const fetchImpl = vi.fn<GithubFetch>(async () => response([], { status: 403 }));
    await expect(fetchLatestPersonalRelease({ fetchImpl })).rejects.toBeInstanceOf(
      GithubReleaseError,
    );
  });

  it("rejects non-list payloads", async () => {
    const fetchImpl = vi.fn<GithubFetch>(async () => response({}));
    await expect(fetchLatestPersonalRelease({ fetchImpl })).rejects.toThrow(
      "GitHub releases response was not a list.",
    );
  });
});

describe("resolveLatestReleaseCandidate", () => {
  it("resolves the release into a candidate with metadata", async () => {
    const fetchImpl = vi.fn<GithubFetch>(async (url) => {
      if (url === METADATA_URL) return response(metadataJson());
      return response([releaseJson()], { headers: { etag: "etag-1" } });
    });
    const { result, etag } = await resolveLatestReleaseCandidate({ fetchImpl });
    expect(etag).toBe("etag-1");
    expect(result.errorMessage).toBeNull();
    expect(result.candidate).toEqual({
      tag: "personal-20260913-1200-abcdef1",
      version: "0.8.0",
      commit: "abcdef1234567890abcdef1234567890abcdef12",
      builtAt: "2026-09-13T12:00:00Z",
      notes: "## 0.8.0",
      localChanges: "- feat: thing (abcdef1)",
      publishedAt: "2026-09-13T12:00:00Z",
      zipAsset: { name: "Paseo-arm64.zip", downloadUrl: ZIP_URL, size: 100 },
      metadataAsset: { name: "build.json", downloadUrl: METADATA_URL, size: 100 },
      sha256: "a".repeat(64),
    });
  });

  it("reports a release without the zip asset", async () => {
    const fetchImpl = vi.fn<GithubFetch>(async (url) => {
      if (url === METADATA_URL) return response(metadataJson());
      return response([releaseJson({ assets: [releaseAsset("build.json", METADATA_URL)] })]);
    });
    const { result } = await resolveLatestReleaseCandidate({ fetchImpl });
    expect(result.candidate).toBeNull();
    expect(result.errorMessage).toContain("Paseo-arm64.zip");
  });

  it("reports a release without metadata", async () => {
    const fetchImpl = vi.fn<GithubFetch>(async () => response([releaseJson({ assets: [] })]));
    const { result } = await resolveLatestReleaseCandidate({ fetchImpl });
    expect(result.candidate).toBeNull();
    expect(result.errorMessage).toContain("build.json");
  });

  it("returns no candidate when the list has no personal release", async () => {
    const fetchImpl = vi.fn<GithubFetch>(async () =>
      response([releaseJson({ tag_name: "v0.9.0" })]),
    );
    const { result } = await resolveLatestReleaseCandidate({ fetchImpl });
    expect(result).toEqual({ candidate: null, errorMessage: null });
  });
});
