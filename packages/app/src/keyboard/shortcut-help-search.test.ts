import { describe, expect, it } from "vitest";
import {
  buildEffectiveBindings,
  buildKeyboardShortcutHelpSections,
  UNASSIGNED_COMBO,
  type ShortcutOverrides,
} from "./keyboard-shortcuts";
import {
  filterShortcutHelpSectionsByChord,
  filterShortcutHelpSections,
  searchShortcutHelpSections,
  shortcutSearchText,
} from "./shortcut-help-search";
import { chordStringToShortcutKeys } from "./shortcut-string";

const MAC_DESKTOP = { isMac: true, isDesktop: true };
const NEW_WORKSPACE_BINDING = "workspace-new-cmd-n-mac";

/**
 * The i18n port, filled with the real English strings the rows use. Translation
 * is the only dependency the filter cannot compute, so it is injected rather
 * than mocked.
 */
const EN: Record<string, string> = {
  "settings.shortcuts.sections.projects": "Projects",
  "settings.shortcuts.help.newWorkspace": "New workspace",
  "settings.shortcuts.help.openProject": "Open project",
};

function translate(key: string): string {
  return EN[key] ?? key;
}

function filter(query: string, overrides: ShortcutOverrides = {}) {
  return filterShortcutHelpSections({
    sections: buildKeyboardShortcutHelpSections(MAC_DESKTOP, buildEffectiveBindings(overrides)),
    query,
    translate,
    shortcutOs: "mac",
  });
}

function matchedRowIds(query: string, overrides: ShortcutOverrides = {}): string[] {
  return filter(query, overrides).flatMap((section) => section.rows.map((row) => row.id));
}

function search(query: string, overrides: ShortcutOverrides = {}) {
  return searchShortcutHelpSections({
    sections: buildKeyboardShortcutHelpSections(MAC_DESKTOP, buildEffectiveBindings(overrides)),
    query,
    translate,
    shortcutOs: "mac",
  });
}

function matchedSearchRowIds(query: string, overrides: ShortcutOverrides = {}): string[] {
  return search(query, overrides).flatMap((section) => section.rows.map((row) => row.id));
}

function byChord(comboString: string, overrides: ShortcutOverrides = {}) {
  return filterShortcutHelpSectionsByChord({
    sections: buildKeyboardShortcutHelpSections(MAC_DESKTOP, buildEffectiveBindings(overrides)),
    chord: chordStringToShortcutKeys(comboString),
    overrides,
    platform: MAC_DESKTOP,
  });
}

function rowIds(sections: ReturnType<typeof byChord>): string[] {
  return sections.flatMap((section) => section.rows.map((row) => row.id));
}

describe("shortcutSearchText", () => {
  it("covers the tokens, the rendered badge, and the modifier aliases", () => {
    const text = shortcutSearchText([["mod", "N"]], "mac");

    expect(text).toContain("mod N");
    expect(text).toContain("⌘N");
    expect(text).toContain("cmd+N");
    expect(text).toContain("command+N");
  });

  // The alias expansion is combinatorial, so a flattened chord would multiply
  // the two combos together and invent spellings for keys never pressed at once.
  it("keeps a multi-step chord's combos apart", () => {
    const text = shortcutSearchText(
      [
        ["mod", "K"],
        ["mod", "N"],
      ],
      "mac",
    );

    expect(text).toContain("cmd+K");
    expect(text).toContain("cmd+N");
    expect(text).not.toContain("cmd+K+cmd+N");
  });
});

describe("filterShortcutHelpSections", () => {
  it("returns every section for a blank query", () => {
    expect(filter("  ")).toHaveLength(buildKeyboardShortcutHelpSections(MAC_DESKTOP).length);
  });

  it("matches a row by its label", () => {
    expect(matchedRowIds("new workspace")).toContain("new-workspace");
  });

  it("matches a row by the rendered badge", () => {
    expect(matchedRowIds("⌘n")).toContain("new-workspace");
  });

  it("matches a row by a spelled-out modifier", () => {
    expect(matchedRowIds("command+n")).toContain("new-workspace");
  });

  // The reported bug, from the search side: the cheat sheet has to stop finding
  // a row by keys the user has rebound away from.
  it("finds a rebound row by its new keys and not by the superseded default", () => {
    const overrides = { [NEW_WORKSPACE_BINDING]: "Cmd+Shift+K" };

    expect(matchedRowIds("cmd+shift+k", overrides)).toContain("new-workspace");
    expect(matchedRowIds("cmd+n", overrides)).not.toContain("new-workspace");
  });

  it("still finds an unassigned row by its label", () => {
    const overrides = { [NEW_WORKSPACE_BINDING]: UNASSIGNED_COMBO };

    expect(matchedRowIds("new workspace", overrides)).toContain("new-workspace");
    expect(matchedRowIds("cmd+n", overrides)).not.toContain("new-workspace");
  });

  it("keeps every row of a section whose own title matches", () => {
    const matched = filter("layout").find((section) => section.id === "layout");
    const all = buildKeyboardShortcutHelpSections(MAC_DESKTOP).find(
      (section) => section.id === "layout",
    );

    expect(matched?.rows).toHaveLength(all?.rows.length ?? 0);
  });

  it("drops a section whose rows all miss", () => {
    expect(filter("no shortcut spells this")).toEqual([]);
  });
});

describe("searchShortcutHelpSections", () => {
  it("returns every section for a blank query", () => {
    const searched = search("  ");
    expect(searched).toHaveLength(buildKeyboardShortcutHelpSections(MAC_DESKTOP).length);
  });

  it("matches a row by a subsequence of its label", () => {
    expect(matchedSearchRowIds("nwsp")).toContain("new-workspace");
  });

  it("matches a row through a typo in its label", () => {
    // Subsequence cannot reach this: the transposed pair breaks the in-order walk.
    expect(matchedSearchRowIds("workspcae")).toContain("new-workspace");
  });

  it("matches a row by its keys and their aliases", () => {
    expect(matchedSearchRowIds("cmd+n")).toContain("new-workspace");
    expect(matchedSearchRowIds("⌘n")).toContain("new-workspace");
  });

  it("stops finding a row by keys it was rebound away from", () => {
    const overrides = { [NEW_WORKSPACE_BINDING]: "Cmd+Shift+K" };

    expect(matchedSearchRowIds("cmd+shift+k", overrides)).toContain("new-workspace");
    expect(matchedSearchRowIds("cmd+n", overrides)).not.toContain("new-workspace");
  });

  it("keeps the manual order and drops sections whose rows all miss", () => {
    const searched = search("workspace");

    for (const section of searched) {
      const all = buildKeyboardShortcutHelpSections(MAC_DESKTOP).find(
        (candidate) => candidate.id === section.id,
      );
      expect(all).toBeDefined();
      const allIds = all?.rows.map((row) => row.id) ?? [];
      const keptIds = section.rows.map((row) => row.id);
      expect(keptIds).toEqual(allIds.filter((id) => keptIds.includes(id)));
    }
  });

  it("returns nothing for a query no row matches", () => {
    expect(search("zzzqqq")).toEqual([]);
  });
});

describe("filterShortcutHelpSectionsByChord", () => {
  it("narrows to the row whose default keys were captured", () => {
    expect(rowIds(byChord("Cmd+N"))).toEqual(["new-workspace"]);
  });

  it("does not match a chord with an extra modifier", () => {
    expect(rowIds(byChord("Shift+Cmd+N"))).not.toContain("new-workspace");
  });

  it("matches a rebound row by its override instead of the default", () => {
    expect(rowIds(byChord("Ctrl+Alt+T", { [NEW_WORKSPACE_BINDING]: "Ctrl+Alt+T" }))).toEqual([
      "new-workspace",
    ]);
    expect(byChord("Cmd+N", { [NEW_WORKSPACE_BINDING]: "Ctrl+Alt+T" })).toEqual([]);
  });

  it("never matches a row the user unassigned", () => {
    expect(byChord("Cmd+N", { [NEW_WORKSPACE_BINDING]: UNASSIGNED_COMBO })).toEqual([]);
  });

  it("returns nothing when no binding fires the captured chord", () => {
    expect(byChord("Cmd+Shift+9")).toEqual([]);
  });
});
