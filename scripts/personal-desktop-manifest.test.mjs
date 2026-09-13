import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildManifest, renderReleaseNotes } from "./personal-desktop-manifest.mjs";

const CHANGELOG = `# Changelog

## 0.8.1 - 2026-09-14

### Fixed

- Fixed the remote updater (#123)

## 0.8.0 - 2026-09-10

- Earlier release
`;

test("buildManifest hashes the zip and keeps the local build.json shape", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "paseo-manifest-"));
  try {
    const zipPath = path.join(directory, "Paseo-arm64.zip");
    writeFileSync(zipPath, "archive-bytes");
    const manifest = buildManifest({
      version: "0.8.1",
      commit: "abcdef1234567890",
      builtAt: "2026-09-14T10:00:00Z",
      zipPath,
      notes: "## 0.8.1",
      localChanges: "- feat: thing (abcdef1)",
    });
    assert.deepEqual(manifest, {
      version: "0.8.1",
      commit: "abcdef1234567890",
      builtAt: "2026-09-14T10:00:00Z",
      notes: "## 0.8.1",
      localChanges: "- feat: thing (abcdef1)",
      sha256: createHash("sha256").update("archive-bytes").digest("hex"),
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("renderReleaseNotes appends local changes only when present", () => {
  assert.equal(
    renderReleaseNotes({ notes: "## 0.8.1\n\n- Fixed", localChanges: "- feat: thing (abcdef1)" }),
    "## 0.8.1\n\n- Fixed\n\n### Local changes\n\n- feat: thing (abcdef1)\n",
  );
  assert.equal(renderReleaseNotes({ notes: "## 0.8.1", localChanges: "" }), "## 0.8.1\n");
});

test("extractReleaseNotes handles the changelog lookup through the manifest script", async () => {
  const { extractReleaseNotes } = await import("./local-build-notes.mjs");
  const notes = extractReleaseNotes(CHANGELOG, "0.8.1");
  assert.match(notes, /## 0.8.1 - 2026-09-14/);
  assert.doesNotMatch(notes, /0.8.0/);
});
