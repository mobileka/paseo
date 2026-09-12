import { describe, expect, it } from "vitest";
import { filterSidebarItems, type SettingsSidebarItem } from "./section-filter";

const ITEMS: SettingsSidebarItem[] = [
  { id: "general", labelKey: "settings.sections.general" },
  { id: "appearance", labelKey: "settings.sections.appearance" },
  { id: "shortcuts", labelKey: "settings.sections.shortcuts" },
  { id: "notifications", labelKey: "settings.sections.notifications" },
  { id: "about", labelKey: "settings.sections.about" },
];

const EN: Record<string, string> = {
  "settings.sections.general": "General",
  "settings.sections.appearance": "Appearance",
  "settings.sections.shortcuts": "Shortcuts",
  "settings.sections.notifications": "Notifications",
  "settings.sections.about": "About",
};

function translate(key: string): string {
  return EN[key] ?? key;
}

function filter(query: string, activeId: string | null = null): string[] {
  return filterSidebarItems({ items: ITEMS, query, translate, activeId }).map((item) => item.id);
}

describe("filterSidebarItems", () => {
  it("returns every item for a blank query", () => {
    expect(filter("  ")).toEqual(["general", "appearance", "shortcuts", "notifications", "about"]);
  });

  it("matches a label by subsequence", () => {
    expect(filter("ntfctns")).toEqual(["notifications"]);
  });

  it("matches a label through a typo", () => {
    expect(filter("Genral")).toEqual(["general"]);
  });

  it("keeps the manual order across matches", () => {
    expect(filter("a")).toEqual(["general", "appearance", "notifications", "about"]);
  });

  it("returns nothing when no label matches", () => {
    expect(filter("zzzqqq")).toEqual([]);
  });

  it("pins the active section even when its label misses", () => {
    expect(filter("zzzqqq", "shortcuts")).toEqual(["shortcuts"]);
    expect(filter("ntfctns", "general")).toEqual(["general", "notifications"]);
  });
});
