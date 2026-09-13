const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export const PERSONAL_RELEASE_REPO = "mobileka/paseo";
export const PERSONAL_RELEASE_TAG_PREFIX = "personal-";
export const RELEASE_ZIP_ASSET_NAME = "Paseo-arm64.zip";
export const RELEASE_METADATA_ASSET_NAME = "build.json";

const GITHUB_API_BASE = "https://api.github.com";
const RELEASES_PER_PAGE = 30;
const REQUEST_TIMEOUT_MS = 10_000;

export class GithubReleaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GithubReleaseError";
  }
}

export interface GithubFetchResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export interface GithubFetchInit {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Structural subset of `fetch`/Electron `net.fetch`. The server uses
 * `net.fetch` so the check honors the system proxy.
 */
export type GithubFetch = (url: string, init?: GithubFetchInit) => Promise<GithubFetchResponse>;

export interface GithubReleaseAsset {
  name: string;
  downloadUrl: string;
  size: number;
}

export interface GithubRelease {
  tag: string;
  name: string;
  body: string | null;
  publishedAt: string | null;
  assets: GithubReleaseAsset[];
}

export interface GithubReleaseMetadata {
  version: string;
  commit: string;
  builtAt: string;
  notes: string | null;
  localChanges: string | null;
  sha256: string | null;
}

export interface GithubReleaseCandidate {
  tag: string;
  version: string;
  commit: string;
  builtAt: string;
  notes: string | null;
  localChanges: string | null;
  publishedAt: string | null;
  zipAsset: GithubReleaseAsset;
  metadataAsset: GithubReleaseAsset;
  sha256: string | null;
}

export interface GithubReleaseFetchResult {
  candidate: GithubReleaseCandidate | null;
  errorMessage: string | null;
}

export interface FetchReleasesResult {
  releases: GithubRelease[];
  etag: string | null;
  notModified: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseAsset(raw: unknown): GithubReleaseAsset | null {
  if (!isRecord(raw)) return null;
  const name = readString(raw, "name");
  const downloadUrl = readString(raw, "browser_download_url");
  const size = typeof raw.size === "number" && Number.isFinite(raw.size) ? raw.size : 0;
  if (!name || !downloadUrl) return null;
  return { name, downloadUrl, size };
}

export function parseGithubRelease(raw: unknown): GithubRelease | null {
  if (!isRecord(raw)) return null;
  if (raw.draft === true) return null;
  const tag = readString(raw, "tag_name");
  if (!tag) return null;
  const assets = Array.isArray(raw.assets)
    ? raw.assets.map(parseAsset).filter((asset): asset is GithubReleaseAsset => asset !== null)
    : [];
  return {
    tag,
    name: readString(raw, "name") ?? tag,
    body: readString(raw, "body"),
    publishedAt: readString(raw, "published_at"),
    assets,
  };
}

export function parseReleaseMetadata(raw: unknown): GithubReleaseMetadata | null {
  if (!isRecord(raw)) return null;
  const version = readString(raw, "version");
  const commit = readString(raw, "commit");
  const builtAt = readString(raw, "builtAt");
  if (!version || !commit || !COMMIT_PATTERN.test(commit) || !builtAt) return null;
  const sha256 = readString(raw, "sha256");
  return {
    version,
    commit: commit.toLowerCase(),
    builtAt,
    notes: readString(raw, "notes"),
    localChanges: readString(raw, "localChanges"),
    sha256: sha256 && SHA256_PATTERN.test(sha256) ? sha256.toLowerCase() : null,
  };
}

export function isPersonalReleaseTag(tag: string): boolean {
  return (
    tag.startsWith(PERSONAL_RELEASE_TAG_PREFIX) && tag.length > PERSONAL_RELEASE_TAG_PREFIX.length
  );
}

export function selectLatestPersonalRelease(releases: GithubRelease[]): GithubRelease | null {
  let latest: GithubRelease | null = null;
  for (const release of releases) {
    if (!isPersonalReleaseTag(release.tag)) continue;
    if (!latest) {
      latest = release;
      continue;
    }
    const latestTime = latest.publishedAt ?? "";
    const releaseTime = release.publishedAt ?? "";
    if (releaseTime > latestTime) latest = release;
  }
  return latest;
}

export function createReleaseCandidate({
  release,
  metadata,
}: {
  release: GithubRelease;
  metadata: GithubReleaseMetadata;
}): GithubReleaseCandidate | null {
  const zipAsset = release.assets.find((asset) => asset.name === RELEASE_ZIP_ASSET_NAME) ?? null;
  const metadataAsset =
    release.assets.find((asset) => asset.name === RELEASE_METADATA_ASSET_NAME) ?? null;
  if (!zipAsset || !metadataAsset) return null;
  return {
    tag: release.tag,
    version: metadata.version,
    commit: metadata.commit,
    builtAt: metadata.builtAt,
    notes: metadata.notes,
    localChanges: metadata.localChanges,
    publishedAt: release.publishedAt,
    zipAsset,
    metadataAsset,
    sha256: metadata.sha256,
  };
}

export async function fetchLatestPersonalRelease({
  repo = PERSONAL_RELEASE_REPO,
  etag = null,
  fetchImpl,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: {
  repo?: string;
  etag?: string | null;
  fetchImpl: GithubFetch;
  timeoutMs?: number;
}): Promise<FetchReleasesResult> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "paseo-desktop",
  };
  if (etag) headers["if-none-match"] = etag;

  const response = await fetchImpl(
    `${GITHUB_API_BASE}/repos/${repo}/releases?per_page=${RELEASES_PER_PAGE}`,
    { headers, signal: AbortSignal.timeout(timeoutMs) },
  );

  if (response.status === 304) {
    return { releases: [], etag, notModified: true };
  }
  if (response.status === 403 || response.status === 429) {
    throw new GithubReleaseError("GitHub rate limit reached. Try again later.");
  }
  if (!response.ok) {
    throw new GithubReleaseError(`GitHub releases request failed (HTTP ${response.status}).`);
  }

  const raw: unknown = await response.json();
  if (!Array.isArray(raw)) {
    throw new GithubReleaseError("GitHub releases response was not a list.");
  }
  const releases = raw
    .map(parseGithubRelease)
    .filter((release): release is GithubRelease => release !== null);
  return {
    releases,
    etag: response.headers.get("etag") ?? etag,
    notModified: false,
  };
}

export async function fetchReleaseMetadata({
  downloadUrl,
  fetchImpl,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: {
  downloadUrl: string;
  fetchImpl: GithubFetch;
  timeoutMs?: number;
}): Promise<GithubReleaseMetadata> {
  const response = await fetchImpl(downloadUrl, {
    headers: { accept: "application/json", "user-agent": "paseo-desktop" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new GithubReleaseError(`Release metadata request failed (HTTP ${response.status}).`);
  }
  const metadata = parseReleaseMetadata(await response.json());
  if (!metadata) {
    throw new GithubReleaseError("Release metadata was missing or malformed.");
  }
  return metadata;
}

/**
 * Resolves the newest personal release into an installable candidate. A
 * release whose assets or metadata are missing is an error, not "up to date":
 * a malformed release should be visible on a manual check.
 */
export async function resolveLatestReleaseCandidate({
  repo = PERSONAL_RELEASE_REPO,
  fetchImpl,
  etag = null,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: {
  repo?: string;
  fetchImpl: GithubFetch;
  etag?: string | null;
  timeoutMs?: number;
}): Promise<{ result: GithubReleaseFetchResult; etag: string | null }> {
  const releases = await fetchLatestPersonalRelease({ repo, etag, fetchImpl, timeoutMs });
  if (releases.notModified) {
    return { result: { candidate: null, errorMessage: null }, etag: releases.etag };
  }

  const release = selectLatestPersonalRelease(releases.releases);
  if (!release) {
    return { result: { candidate: null, errorMessage: null }, etag: releases.etag };
  }

  const metadataAsset = release.assets.find((asset) => asset.name === RELEASE_METADATA_ASSET_NAME);
  if (!metadataAsset) {
    return {
      result: {
        candidate: null,
        errorMessage: `Release ${release.tag} has no ${RELEASE_METADATA_ASSET_NAME}.`,
      },
      etag: releases.etag,
    };
  }

  const metadata = await fetchReleaseMetadata({
    downloadUrl: metadataAsset.downloadUrl,
    fetchImpl,
    timeoutMs,
  });
  const candidate = createReleaseCandidate({ release, metadata });
  if (!candidate) {
    return {
      result: {
        candidate: null,
        errorMessage: `Release ${release.tag} has no ${RELEASE_ZIP_ASSET_NAME}.`,
      },
      etag: releases.etag,
    };
  }
  return { result: { candidate, errorMessage: null }, etag: releases.etag };
}
