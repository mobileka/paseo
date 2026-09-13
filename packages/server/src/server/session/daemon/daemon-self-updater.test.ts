import { describe, expect, test } from "vitest";
import {
  DaemonSelfUpdater,
  SELF_UPDATE_DISABLED_ERROR,
  type DaemonSelfUpdatePhase,
} from "./daemon-self-updater.js";

interface TestLogger {
  errors: Array<{ obj: object; msg?: string }>;
  warnings: Array<{ obj: object; msg?: string }>;
  error(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

function createLogger(): TestLogger {
  return {
    errors: [],
    warnings: [],
    error(obj, msg) {
      this.errors.push({ obj, msg });
    },
    warn(obj, msg) {
      this.warnings.push({ obj, msg });
    },
  };
}

async function runUpdate(input: { desktopManaged?: boolean } = {}) {
  const logger = createLogger();
  const phases: DaemonSelfUpdatePhase[] = [];
  const result = await new DaemonSelfUpdater().update({
    daemonVersion: "0.8.0",
    desktopManaged: input.desktopManaged ?? false,
    onProgress: (phase) => phases.push(phase),
    logger,
  });
  return { result, logger, phases };
}

describe("DaemonSelfUpdater", () => {
  test("refuses self-update without emitting progress", async () => {
    const { result, logger, phases } = await runUpdate();

    expect(result).toEqual({
      success: false,
      error: SELF_UPDATE_DISABLED_ERROR,
      newVersion: null,
    });
    expect(phases).toEqual([]);
    expect(logger.errors).toEqual([]);
  });

  test("keeps the desktop-managed message for a Desktop-managed daemon", async () => {
    const { result, phases } = await runUpdate({ desktopManaged: true });

    expect(result).toEqual({
      success: false,
      error: "This daemon is managed by Paseo Desktop. Update Paseo Desktop on the host.",
      newVersion: null,
    });
    expect(phases).toEqual([]);
  });
});
