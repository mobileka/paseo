#!/usr/bin/env node
// Extract one release section from CHANGELOG.md so the macOS build pipeline can
// bake it into the staged build's build.json. The app reads that file as the
// "What's new" notes for a local update, so the text never comes from the
// network.
//
// Usage: node scripts/local-build-notes.mjs <version> [changelogPath]
// Prints the section verbatim (heading included) or exits 1 when the version
// has no section; the caller is expected to fall back to a bare heading.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE_HEADING = /^ {0,3}##(?:[ \t]+(.*?))?[ \t]*$/;
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const BRACKETED = /^\[(.*)\]$/;
const LEADING_V = /^v(?=\d)/i;
const DASH_SEPARATED_DATE = /^(.*?)\s+[-–—]\s+(.+)$/;
const PARENTHESIZED_DATE = /^(.*?)\s*\((.+)\)$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function normalizeVersion(raw) {
  const plain = raw
    .trim()
    .replace(MARKDOWN_LINK, "$1")
    .replace(BRACKETED, "$1")
    .trim()
    .replace(LEADING_V, "");
  return VERSION.test(plain) ? plain : null;
}

function headingVersion(heading) {
  const plain = heading.replace(MARKDOWN_LINK, "$1").trim();
  const dashed = plain.match(DASH_SEPARATED_DATE);
  if (dashed) return normalizeVersion(dashed[1]);
  const parenthesized = plain.match(PARENTHESIZED_DATE);
  if (parenthesized) return normalizeVersion(parenthesized[1]);
  return normalizeVersion(plain);
}

function findSection(markdown, version) {
  const wanted = normalizeVersion(version);
  if (!wanted) return null;

  const lines = markdown.split(/\r?\n/);
  let start = -1;
  let end = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(RELEASE_HEADING)?.[1];
    if (heading === undefined) continue;
    if (start === -1) {
      if (headingVersion(heading) === wanted) start = index;
    } else {
      end = index;
      break;
    }
  }

  if (start === -1) return null;
  return lines.slice(start, end).join("\n").trim();
}

export function extractReleaseNotes(markdown, version) {
  const wanted = normalizeVersion(version);
  if (!wanted) return null;

  const exact = findSection(markdown, wanted);
  if (exact) return exact;

  // Fork versions carry a `-personal.N` prerelease that upstream changelogs
  // never use, so fall back to the base version's section.
  const base = wanted.split("-")[0];
  return base === wanted ? null : findSection(markdown, base);
}

function main() {
  const [, , version, changelogArg] = process.argv;
  if (!version) {
    console.error("Usage: node scripts/local-build-notes.mjs <version> [changelogPath]");
    process.exit(1);
  }

  const changelogPath = path.resolve(changelogArg ?? path.join(process.cwd(), "CHANGELOG.md"));
  let markdown;
  try {
    markdown = readFileSync(changelogPath, "utf8");
  } catch (error) {
    console.error(
      `Unable to read ${changelogPath}: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }

  const notes = extractReleaseNotes(markdown, version);
  if (!notes) {
    console.error(`No changelog section for version ${version} in ${changelogPath}`);
    process.exit(1);
  }

  process.stdout.write(`${notes}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
