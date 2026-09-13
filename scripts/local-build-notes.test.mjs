import assert from "node:assert/strict";
import test from "node:test";
import { extractReleaseNotes } from "./local-build-notes.mjs";

const CHANGELOG = `# Changelog

Intro prose the parser must ignore.

## 0.8.0 - 2026-09-10

Headline for 0.8.0.

### Added

- Something new ([#1](https://example.com/1))

### Fixes

- Something fixed

## 0.7.2 - 2026-09-02

Older release.
`;

test("extracts the section for the requested version including its heading", () => {
  assert.equal(
    extractReleaseNotes(CHANGELOG, "0.8.0"),
    `## 0.8.0 - 2026-09-10

Headline for 0.8.0.

### Added

- Something new ([#1](https://example.com/1))

### Fixes

- Something fixed`,
  );
});

test("stops at the next release heading", () => {
  const notes = extractReleaseNotes(CHANGELOG, "0.7.2");
  assert.equal(notes, "## 0.7.2 - 2026-09-02\n\nOlder release.");
});

test("accepts bracket, link, and v-prefixed headings", () => {
  const markdown = [
    "## [0.9.0] - 2026-09-20",
    "",
    "- bracketed",
    "",
    "## [v0.8.1](https://example.com/v0.8.1) (2026-09-12)",
    "",
    "- linked",
    "",
  ].join("\n");
  assert.equal(extractReleaseNotes(markdown, "0.9.0"), "## [0.9.0] - 2026-09-20\n\n- bracketed");
  assert.equal(
    extractReleaseNotes(markdown, "v0.8.1"),
    "## [v0.8.1](https://example.com/v0.8.1) (2026-09-12)\n\n- linked",
  );
});

test("returns null when the version has no section", () => {
  assert.equal(extractReleaseNotes(CHANGELOG, "9.9.9"), null);
  assert.equal(extractReleaseNotes(CHANGELOG, "not-a-version"), null);
});

test("does not treat ### section headings as release headings", () => {
  const notes = extractReleaseNotes(CHANGELOG, "0.8.0");
  assert.ok(notes?.includes("### Added"));
});
