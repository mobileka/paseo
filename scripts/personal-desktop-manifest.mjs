#!/usr/bin/env node
// Builds the GitHub release assets for a personal desktop release: build.json
// (the same shape the local refresh script stages) and the human-readable
// release notes. The desktop app reads build.json as its update metadata, so
// both the local and GitHub channels speak one format.
//
// Usage:
//   node scripts/personal-desktop-manifest.mjs \
//     --version 0.8.0 --commit <sha> --built-at <iso> \
//     --zip Paseo-arm64.zip --out build.json --notes-out release-notes.md \
//     [--repo <path>] [--previous-tag personal-...] [--changelog CHANGELOG.md]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractReleaseNotes } from "./local-build-notes.mjs";

function readNotes({ changelogPath, version, builtAt }) {
  try {
    const markdown = readFileSync(changelogPath, "utf8");
    const notes = extractReleaseNotes(markdown, version);
    if (notes) return notes;
  } catch {
    // Fall through to the bare heading below.
  }
  return `## ${version} - ${builtAt.slice(0, 10)}`;
}

function readLocalChanges({
  repo,
  previousTag,
  commit,
  git = (args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }),
}) {
  const args = previousTag
    ? ["log", "--no-merges", "--format=- %s (%h)", `${previousTag}..${commit}`]
    : ["log", "--no-merges", "--format=- %s (%h)", "-10", commit];
  try {
    return git(args).trim();
  } catch {
    return "";
  }
}

function readSha256(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

export function buildManifest({ version, commit, builtAt, zipPath, notes, localChanges }) {
  return {
    version,
    commit,
    builtAt,
    notes,
    localChanges,
    sha256: readSha256(zipPath),
  };
}

export function renderReleaseNotes({ notes, localChanges }) {
  const sections = [notes.trim()];
  const changes = localChanges.trim();
  if (changes) {
    sections.push(`### Local changes\n\n${changes}`);
  }
  return `${sections.join("\n\n")}\n`;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) throw new Error(`Unexpected argument: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    values[flag.slice(2)] = value;
    index += 1;
  }
  return values;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ["version", "commit", "built-at", "zip", "out", "notes-out"];
  for (const name of required) {
    if (!args[name]) {
      console.error(`Missing --${name}`);
      process.exit(1);
    }
  }

  const repo = path.resolve(args.repo ?? process.cwd());
  const changelogPath = path.resolve(args.changelog ?? path.join(repo, "CHANGELOG.md"));
  const version = args.version;
  const commit = args.commit;
  const builtAt = args["built-at"];

  const notes = readNotes({ changelogPath, version, builtAt });
  const localChanges = readLocalChanges({
    repo,
    previousTag: args["previous-tag"] ?? null,
    commit,
  });
  const manifest = buildManifest({
    version,
    commit,
    builtAt,
    zipPath: path.resolve(args.zip),
    notes,
    localChanges,
  });

  writeFileSync(path.resolve(args.out), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.resolve(args["notes-out"]), renderReleaseNotes({ notes, localChanges }));
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
