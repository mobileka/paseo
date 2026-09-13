import type { AppUpdateCheckResult } from "./app-update-service.js";

export type ManualUpdateCheckOutcome =
  | { kind: "update" }
  | { kind: "up-to-date"; version: string }
  | { kind: "error"; message: string };

export interface ManualUpdateCheckMessageBox {
  type: "info" | "error";
  title: string;
  message: string;
}

export interface ManualUpdateCheckDeps {
  check: () => Promise<AppUpdateCheckResult>;
  notifyRenderer: () => void;
  showMessageBox: (input: ManualUpdateCheckMessageBox) => Promise<void>;
}

export function formatManualUpdateOutcome(result: AppUpdateCheckResult): ManualUpdateCheckOutcome {
  if (result.hasUpdate) {
    return { kind: "update" };
  }
  if (result.errorMessage) {
    return { kind: "error", message: result.errorMessage };
  }
  return { kind: "up-to-date", version: result.currentVersion };
}

export function createManualUpdateCheck(deps: ManualUpdateCheckDeps): () => Promise<void> {
  return async function runManualUpdateCheck(): Promise<void> {
    let outcome: ManualUpdateCheckOutcome;
    try {
      outcome = formatManualUpdateOutcome(await deps.check());
    } catch (error) {
      outcome = {
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (outcome.kind === "update") {
      deps.notifyRenderer();
      return;
    }

    if (outcome.kind === "error") {
      await deps.showMessageBox({
        type: "error",
        title: "Couldn't check for updates",
        message: outcome.message,
      });
      return;
    }

    await deps.showMessageBox({
      type: "info",
      title: "Paseo is up to date",
      message: `Version ${outcome.version}`,
    });
  };
}
