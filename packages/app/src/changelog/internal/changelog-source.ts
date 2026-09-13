import { useCallback, useEffect, useState } from "react";
import { getLocalChangelog, type LocalChangelogEntry } from "@/desktop/updates/desktop-updates";
import { parseChangelog, type ChangelogSection } from "./parse-changelog";

export interface ChangelogEntry {
  version: string;
  date: string;
  isRunning: boolean;
  localChanges: string | null;
  sections: ChangelogSection[];
}

export type ChangelogState =
  | { status: "loading" }
  | { status: "ready"; entries: ChangelogEntry[] }
  | { status: "error" };

export interface Changelog {
  state: ChangelogState;
  reload: () => void;
}

/**
 * Reads the changelog from the local staged builds.
 *
 * The fork updates from `builds/` on this machine, so the notes and local
 * changes baked into each `build.json` are the whole changelog. There is no
 * network request: a stock bundle has no local update channel and reports an
 * empty list.
 */
export function useChangelog(enabled: boolean): Changelog {
  const [state, setState] = useState<ChangelogState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setState({ status: "loading" });

    void (async () => {
      try {
        const entries = await getLocalChangelog();
        if (cancelled) return;
        setState({ status: "ready", entries: entries.map(toChangelogEntry) });
      } catch {
        if (cancelled) return;
        setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, attempt]);

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  return { state, reload };
}

function toChangelogEntry(entry: LocalChangelogEntry): ChangelogEntry {
  const release = entry.notes ? parseChangelog(entry.notes)[0] : undefined;
  return {
    version: release?.version ?? entry.version,
    date: release?.date ?? (entry.builtAt ? entry.builtAt.slice(0, 10) : ""),
    isRunning: entry.isRunning,
    localChanges: entry.localChanges,
    sections: release?.sections ?? [],
  };
}
