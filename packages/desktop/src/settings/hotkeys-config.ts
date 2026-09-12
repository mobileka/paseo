import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

export type HotkeyOverrides = Record<string, string | null>;

export interface HotkeysConfig {
  overrides: HotkeyOverrides;
  /** False only while the file has never been written; drives the renderer's one-time AsyncStorage migration. */
  exists: boolean;
}

export interface HotkeysConfigStore {
  get(): Promise<HotkeysConfig>;
  set(overrides: unknown): Promise<HotkeysConfig>;
}

const HOTKEYS_FILENAME = "hotkeys.json";

const HotkeyOverridesSchema = z.record(z.string(), z.string().nullable());

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

export function createHotkeysConfigStore({ paseoHome }: { paseoHome: string }): HotkeysConfigStore {
  const filePath = path.join(paseoHome, HOTKEYS_FILENAME);
  let persistQueue: Promise<void> = Promise.resolve();

  async function persistOverrides(overrides: HotkeyOverrides): Promise<void> {
    const write = async () => {
      await mkdir(paseoHome, { recursive: true });
      const tempFilePath = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
      await writeFile(tempFilePath, `${JSON.stringify(overrides, null, 2)}\n`, "utf8");
      await rename(tempFilePath, filePath);
    };
    const queued = persistQueue.then(write, write);
    persistQueue = queued.catch(() => undefined);
    await queued;
  }

  return {
    async get(): Promise<HotkeysConfig> {
      let raw: string;
      try {
        raw = await readFile(filePath, "utf8");
      } catch (error) {
        if (!isNodeError(error) || error.code !== "ENOENT") {
          throw error;
        }
        // Deliberately no write here: creating the file on read would flip
        // `exists` and skip the renderer's AsyncStorage migration.
        return { overrides: {}, exists: false };
      }

      try {
        return { overrides: HotkeyOverridesSchema.parse(JSON.parse(raw)), exists: true };
      } catch (error) {
        console.warn("[HotkeysConfig] Ignoring invalid hotkeys.json:", error);
        // exists stays true so the migration cannot clobber a (broken) file
        // the user may want to repair by hand.
        return { overrides: {}, exists: true };
      }
    },

    async set(overrides: unknown): Promise<HotkeysConfig> {
      const parsed = HotkeyOverridesSchema.parse(overrides);
      await persistOverrides(parsed);
      return { overrides: parsed, exists: true };
    },
  };
}
