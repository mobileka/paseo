import { scoreTextFields } from "@getpaseo/protocol/search/text-match";

export interface SettingsSidebarItem {
  id: string;
  labelKey: string;
}

/**
 * The settings sidebar's fuzzy filter: translated labels matched with the
 * shared tiered scorer, so a subsequence ("ntfctns") and small typos
 * ("Genral") still land. The active section is pinned — it always stays
 * listed even when its label misses — because the content pane must never
 * show a section the nav hides. Gating (desktopOnly/webOnly) is applied by
 * the caller before this runs, so gated sections can never surface through
 * a search.
 */
export function filterSidebarItems<T extends SettingsSidebarItem>({
  items,
  query,
  translate,
  activeId,
}: {
  items: readonly T[];
  query: string;
  translate: (key: string) => string;
  activeId: string | null;
}): T[] {
  if (!query.trim()) return [...items];
  return items.filter(
    (item) =>
      item.id === activeId ||
      scoreTextFields(query, [translate(item.labelKey)], { typoTolerant: true }) !== null,
  );
}
