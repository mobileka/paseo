import { net } from "electron";
import {
  GithubReleaseError,
  PERSONAL_RELEASE_REPO,
  resolveLatestReleaseCandidate,
  type GithubFetch,
  type GithubReleaseCandidate,
} from "./github-releases.js";
import {
  createGithubInstallIo,
  stageGithubRelease,
  type GithubDownloadProgress,
  type GithubInstallIo,
  type GithubStagedBuild,
} from "./github-install.js";

export interface GithubUpdateFetch {
  candidate: GithubReleaseCandidate | null;
  errorMessage: string | null;
}

export interface GithubUpdateDiagnostics {
  repo: string;
  lastCheckedAt: string | null;
  latestTag: string | null;
  latestCommit: string | null;
  lastError: string | null;
  hasEtag: boolean;
}

export interface GithubInstallOptions {
  onProgress?: (progress: GithubDownloadProgress) => void;
}

export interface GithubUpdateSource {
  fetchCandidate: () => Promise<GithubUpdateFetch>;
  install: (
    candidate: GithubReleaseCandidate,
    options?: GithubInstallOptions,
  ) => Promise<GithubStagedBuild>;
  getDiagnostics: () => GithubUpdateDiagnostics;
}

const RELEASE_CHECK_TIMEOUT_MS = 25_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new GithubReleaseError("GitHub update check timed out."));
      }, timeoutMs).unref();
    }),
  ]);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof GithubReleaseError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Latest release metadata is cached under its ETag: a 304 means the release
 * list is unchanged, so the candidate resolved from the previous 200 is still
 * current. Without the cache a 304 would read as "no update".
 */
export function createGithubUpdateSource({
  buildsDir,
  repo = PERSONAL_RELEASE_REPO,
  fetchImpl,
  installIo = createGithubInstallIo(),
  now = () => new Date().toISOString(),
}: {
  buildsDir: string;
  repo?: string;
  fetchImpl: GithubFetch;
  installIo?: GithubInstallIo;
  now?: () => string;
}): GithubUpdateSource {
  let etag: string | null = null;
  let cached: GithubUpdateFetch = { candidate: null, errorMessage: null };
  let diagnostics: GithubUpdateDiagnostics = {
    repo,
    lastCheckedAt: null,
    latestTag: null,
    latestCommit: null,
    lastError: null,
    hasEtag: false,
  };

  function record(result: GithubUpdateFetch): GithubUpdateFetch {
    diagnostics = {
      repo,
      lastCheckedAt: now(),
      latestTag: result.candidate?.tag ?? diagnostics.latestTag,
      latestCommit: result.candidate?.commit ?? diagnostics.latestCommit,
      lastError: result.errorMessage,
      hasEtag: etag !== null,
    };
    cached = result;
    return result;
  }

  async function fetchCandidate(): Promise<GithubUpdateFetch> {
    try {
      const { result, etag: nextEtag } = await withTimeout(
        resolveLatestReleaseCandidate({
          repo,
          fetchImpl,
          etag,
        }),
        RELEASE_CHECK_TIMEOUT_MS,
      );
      etag = nextEtag;
      if (result.candidate === null && result.errorMessage === null) {
        return record({ candidate: cached.candidate, errorMessage: cached.errorMessage });
      }
      return record(result);
    } catch (error) {
      return record({ candidate: null, errorMessage: toErrorMessage(error) });
    }
  }

  async function install(
    candidate: GithubReleaseCandidate,
    options?: GithubInstallOptions,
  ): Promise<GithubStagedBuild> {
    return await stageGithubRelease({
      buildsDir,
      candidate,
      io: installIo,
      onProgress: options?.onProgress,
    });
  }

  return {
    fetchCandidate,
    install,
    getDiagnostics: () => diagnostics,
  };
}

export function createDefaultGithubUpdateSource({ buildsDir }: { buildsDir: string }) {
  return createGithubUpdateSource({
    buildsDir,
    fetchImpl: (url, init) => net.fetch(url, init),
  });
}
