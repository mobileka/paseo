import { scoreTextFields } from "@getpaseo/protocol/search/text-match";
import type { ShortcutOverrides } from "@/keyboard/keyboard-shortcuts";
import {
  resolveShortcutKeysForAction,
  type KeyboardShortcutHelpSection,
} from "@/keyboard/keyboard-shortcuts";
import { chordsEqual } from "@/keyboard/shortcut-string";
import { formatShortcut, type ShortcutKey, type ShortcutOs } from "@/utils/format-shortcut";

/** Resolves an i18n key to display text. The caller's `t`, injected. */
export type TranslateHelpKey = (key: string) => string;

/**
 * Alternative spellings for one combo, so searching "cmd k" and "command+k" both
 * find ⌘K. The modifier a user types rarely matches the token the binding
 * stores, and never matches the symbol the badge renders.
 */
export function shortcutSearchAliases(
  keys: readonly ShortcutKey[],
  shortcutOs: ShortcutOs,
): string {
  const aliases = keys.map((key) => {
    if (shortcutOs === "mac") {
      if (key === "mod" || key === "meta") return ["cmd", "command"];
      if (key === "alt") return ["alt", "option"];
    } else {
      if (key === "mod" || key === "ctrl") return ["ctrl", "control"];
      if (key === "meta") return ["win", "windows"];
    }
    return [key];
  });
  const combinations = aliases.reduce<string[][]>(
    (prefixes, choices) =>
      prefixes.flatMap((prefix) => choices.map((choice) => [...prefix, choice])),
    [[]],
  );
  return combinations
    .flatMap((combination) => [combination.join(" "), combination.join("+")])
    .join(" ");
}

/**
 * Search text for one row's keys. Built per combo and joined, never over a
 * flattened chord: the alias expansion is combinatorial, so flattening a
 * multi-step chord into one key list both explodes the combination count and
 * invents aliases for combos the user never has to press together.
 */
export function shortcutSearchText(chord: ShortcutKey[][], shortcutOs: ShortcutOs): string {
  return chord
    .flatMap((combo) => [
      combo.join(" "),
      formatShortcut(combo, shortcutOs),
      shortcutSearchAliases(combo, shortcutOs),
    ])
    .join(" ");
}

/**
 * The cheat sheet's sections narrowed to a query, matching on the row's label,
 * its note, and every spelling of the keys that actually fire it. A section
 * whose own title matches keeps all of its rows.
 */
export function filterShortcutHelpSections({
  sections,
  query,
  translate,
  shortcutOs,
}: {
  sections: readonly KeyboardShortcutHelpSection[];
  query: string;
  translate: TranslateHelpKey;
  shortcutOs: ShortcutOs;
}): KeyboardShortcutHelpSection[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...sections];

  return sections.flatMap((section) => {
    if (translate(section.titleKey).toLocaleLowerCase().includes(normalizedQuery)) {
      return [section];
    }

    const rows = section.rows.filter((row) => {
      const { keysField, labelFields } = rowSearchFields(row, translate, shortcutOs);
      const searchText = [...labelFields, keysField ?? ""].join(" ");
      return searchText.toLocaleLowerCase().includes(normalizedQuery);
    });

    return rows.length > 0 ? [{ ...section, rows }] : [];
  });
}

/** Everything one row can be found by: its label and note, and every spelling of its keys. */
function rowSearchFields(
  row: KeyboardShortcutHelpSection["rows"][number],
  translate: TranslateHelpKey,
  shortcutOs: ShortcutOs,
): { labelFields: string[]; keysField: string | null } {
  const labelFields = [
    translate(row.labelKey),
    row.noteKey ? translate(row.noteKey) : row.note,
  ].filter((field): field is string => typeof field === "string" && field.length > 0);
  const keysField = row.chord ? shortcutSearchText(row.chord, shortcutOs) : null;
  return { labelFields, keysField };
}

/**
 * The settings page's filter. Labels and notes match with the shared tiered
 * scorer, so a subsequence ("nwsp" → "New workspace") and small typos
 * ("workspcae") still land. The keys text is matched strictly — the whole
 * query as one substring — because subsequence and typo tolerance over the
 * alias expansion make "cmd+n" hit "cmd+shift+k" text, which would resurface
 * a row by keys the user rebound away from; that guarantee is why
 * `filterShortcutHelpSections` matches substrings in the first place.
 */
export function searchShortcutHelpSections({
  sections,
  query,
  translate,
  shortcutOs,
}: {
  sections: readonly KeyboardShortcutHelpSection[];
  query: string;
  translate: TranslateHelpKey;
  shortcutOs: ShortcutOs;
}): KeyboardShortcutHelpSection[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...sections];

  return sections.flatMap((section) => {
    const rows = section.rows.filter((row) => {
      const { keysField, labelFields } = rowSearchFields(row, translate, shortcutOs);
      if (keysField !== null && keysField.toLocaleLowerCase().includes(normalizedQuery)) {
        return true;
      }
      return scoreTextFields(normalizedQuery, labelFields, { typoTolerant: true }) !== null;
    });
    return rows.length > 0 ? [{ ...section, rows }] : [];
  });
}

/**
 * Narrow to the rows whose effective chord (default, or the user's override)
 * is exactly the captured one. This is the settings page's "search by
 * shortcut" mode; a row with no keys left can never match.
 */
export function filterShortcutHelpSectionsByChord({
  sections,
  chord,
  overrides,
  platform,
}: {
  sections: readonly KeyboardShortcutHelpSection[];
  chord: ShortcutKey[][];
  overrides: ShortcutOverrides;
  platform: { isMac: boolean; isDesktop: boolean };
}): KeyboardShortcutHelpSection[] {
  return sections.flatMap((section) => {
    const rows = section.rows.filter((row) => {
      const resolved = resolveShortcutKeysForAction(row.id, overrides, platform);
      return resolved !== null && chordsEqual(resolved, chord);
    });
    return rows.length > 0 ? [{ ...section, rows }] : [];
  });
}
