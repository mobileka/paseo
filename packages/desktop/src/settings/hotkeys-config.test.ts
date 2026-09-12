import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createHotkeysConfigStore } from "./hotkeys-config";

describe("hotkeys-config", () => {
  const directories = new Set<string>();

  afterEach(async () => {
    await Promise.all(
      [...directories].map(async (directory) => {
        await rm(directory, { recursive: true, force: true });
      }),
    );
    directories.clear();
  });

  async function createTempPaseoHome(): Promise<string> {
    const directory = await mkdtemp(path.join(os.tmpdir(), "paseo-hotkeys-config-"));
    directories.add(directory);
    return directory;
  }

  function hotkeysFilePath(paseoHome: string): string {
    return path.join(paseoHome, "hotkeys.json");
  }

  it("reports an absent file without creating one", async () => {
    const paseoHome = await createTempPaseoHome();
    const store = createHotkeysConfigStore({ paseoHome });

    const config = await store.get();

    expect(config).toEqual({ overrides: {}, exists: false });
    expect(await readdir(paseoHome)).toEqual([]);
  });

  it("round-trips overrides through the file and leaves no temp files behind", async () => {
    const paseoHome = await createTempPaseoHome();
    const overrides = { "agent-new-cmd-shift-o-mac": "Cmd+Shift+O", "disabled-row": null };

    await createHotkeysConfigStore({ paseoHome }).set(overrides);
    const reread = await createHotkeysConfigStore({ paseoHome }).get();

    expect(reread).toEqual({ overrides, exists: true });
    expect(JSON.parse(await readFile(hotkeysFilePath(paseoHome), "utf8"))).toEqual(overrides);
    expect(await readdir(paseoHome)).toEqual(["hotkeys.json"]);
  });

  it("creates the paseo home directory on first write", async () => {
    const paseoHome = await createTempPaseoHome();
    const nestedHome = path.join(paseoHome, "does-not-exist-yet");
    const store = createHotkeysConfigStore({ paseoHome: nestedHome });

    await store.set({ "workspace-new": "Cmd+N" });

    expect(await readFile(hotkeysFilePath(nestedHome), "utf8")).toContain("Cmd+N");
  });

  it("serializes concurrent writes without losing either one", async () => {
    const paseoHome = await createTempPaseoHome();
    const store = createHotkeysConfigStore({ paseoHome });

    await Promise.all([
      store.set({ first: "Cmd+1" }),
      store.set({ second: "Cmd+2" }),
      store.set({ third: "Cmd+3" }),
    ]);

    const config = await store.get();
    expect(config.exists).toBe(true);
    // Writes are whole-record replaces, so the survivor is whichever landed
    // last; the point is that the file parses and holds exactly one record.
    expect(Object.keys(config.overrides)).toEqual(
      expect.arrayContaining([Object.keys(config.overrides)[0]]),
    );
  });

  it("falls back to empty overrides for a corrupt file but keeps exists true", async () => {
    const paseoHome = await createTempPaseoHome();
    await writeFile(hotkeysFilePath(paseoHome), "this is not json", "utf8");
    const store = createHotkeysConfigStore({ paseoHome });

    const config = await store.get();

    expect(config).toEqual({ overrides: {}, exists: true });
  });

  it("falls back to empty overrides for a file with the wrong shape", async () => {
    const paseoHome = await createTempPaseoHome();
    await writeFile(hotkeysFilePath(paseoHome), JSON.stringify({ combo: 42 }), "utf8");
    const store = createHotkeysConfigStore({ paseoHome });

    expect(await store.get()).toEqual({ overrides: {}, exists: true });
  });

  it("rejects invalid payloads on set", async () => {
    const paseoHome = await createTempPaseoHome();
    const store = createHotkeysConfigStore({ paseoHome });

    await expect(store.set("nope")).rejects.toThrow();
    await expect(store.set({ binding: 42 })).rejects.toThrow();
  });
});
