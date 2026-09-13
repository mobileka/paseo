import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  checkDesktopAppUpdate,
  formatBuildLabel,
  installDesktopAppUpdate,
  parseDesktopAppUpdateProgress,
  shouldShowDesktopUpdateSection,
  type DesktopAppUpdateCheckResult,
  type DesktopAppUpdateCheckIntent,
  type DesktopAppUpdateInstallResult,
  type DesktopAppUpdateProgress,
} from "@/desktop/updates/desktop-updates";
import { useDesktopIpcErrorReporter } from "@/desktop/hooks/desktop-ipc-error";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import {
  AUTO_CHECK_INTERVAL_MS,
  PENDING_RECHECK_MS,
  createDesktopAppUpdater,
  formatStatusText,
  type DesktopAppUpdateStatus,
} from "@/desktop/updates/desktop-app-updater";
import { formatMessageTimestamp } from "@/utils/time";

export type { DesktopAppUpdateStatus };

export interface UseDesktopAppUpdaterReturn {
  isDesktopApp: boolean;
  status: DesktopAppUpdateStatus;
  statusText: string;
  availableUpdate: DesktopAppUpdateCheckResult | null;
  errorMessage: string | null;
  installProgress: DesktopAppUpdateProgress | null;
  lastCheckedAt: number | null;
  isChecking: boolean;
  isInstalling: boolean;
  checkForUpdates: (options?: {
    intent?: DesktopAppUpdateCheckIntent;
    silent?: boolean;
  }) => Promise<DesktopAppUpdateCheckResult | null>;
  installUpdate: () => Promise<DesktopAppUpdateInstallResult | null>;
}

export function useDesktopAppUpdater(): UseDesktopAppUpdaterReturn {
  const isDesktopApp = shouldShowDesktopUpdateSection();
  const reportError = useDesktopIpcErrorReporter();

  const updater = useMemo(
    () =>
      createDesktopAppUpdater({
        port: {
          checkDesktopAppUpdate,
          installDesktopAppUpdate,
        },
        now: () => Date.now(),
        reportInstallError: reportError,
      }),
    [reportError],
  );

  const snapshot = useSyncExternalStore(
    updater.subscribe,
    updater.getSnapshot,
    updater.getSnapshot,
  );

  const checkForUpdates = useCallback(
    async (options: { intent?: DesktopAppUpdateCheckIntent; silent?: boolean } = {}) => {
      if (!isDesktopApp) {
        return null;
      }
      return updater.checkForUpdates({
        intent: options.intent ?? "manual",
        silent: options.silent,
      });
    },
    [isDesktopApp, updater],
  );

  const installUpdate = useCallback(async () => {
    if (!isDesktopApp) {
      return null;
    }
    return updater.installUpdate();
  }, [isDesktopApp, updater]);

  useEffect(() => {
    if (!isDesktopApp) {
      return;
    }
    void checkForUpdates({ intent: "automatic", silent: true });
  }, [checkForUpdates, isDesktopApp]);

  useEffect(() => {
    if (!isDesktopApp) {
      return undefined;
    }
    const intervalId = setInterval(() => {
      void checkForUpdates({ intent: "automatic", silent: true });
    }, AUTO_CHECK_INTERVAL_MS);
    return () => {
      clearInterval(intervalId);
    };
  }, [checkForUpdates, isDesktopApp]);

  // The main process pushes this event when a new local build is staged and
  // when the app menu's Check for Updates… item is used.
  useEffect(() => {
    if (!isDesktopApp) {
      return undefined;
    }
    let disposed = false;
    let dispose: (() => void) | null = null;
    listenToDesktopEvent<{ intent?: DesktopAppUpdateCheckIntent } | null>(
      "check-for-updates",
      (payload) => {
        const intent = payload?.intent === "manual" ? "manual" : "automatic";
        void checkForUpdates({ intent, silent: intent === "automatic" });
      },
    )
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return null;
        }
        dispose = unlisten;
        return null;
      })
      .catch(() => {
        // The desktop event API is unavailable outside the packaged app.
      });
    return () => {
      disposed = true;
      dispose?.();
    };
  }, [checkForUpdates, isDesktopApp]);

  useEffect(() => {
    if (!isDesktopApp) {
      return undefined;
    }
    let disposed = false;
    let dispose: (() => void) | null = null;
    listenToDesktopEvent<unknown>("app-update-progress", (payload) => {
      updater.setInstallProgress(parseDesktopAppUpdateProgress(payload));
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return null;
        }
        dispose = unlisten;
        return null;
      })
      .catch(() => {
        // The desktop event API is unavailable outside the packaged app.
      });
    return () => {
      disposed = true;
      dispose?.();
    };
  }, [updater, isDesktopApp]);

  useEffect(() => {
    if (!isDesktopApp || snapshot.status !== "pending") {
      return undefined;
    }

    const intervalId = setInterval(() => {
      void checkForUpdates({ intent: "automatic", silent: true });
    }, PENDING_RECHECK_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [checkForUpdates, isDesktopApp, snapshot.status]);

  return {
    isDesktopApp,
    status: snapshot.status,
    statusText: formatStatusText({
      status: snapshot.status,
      availableUpdate: snapshot.availableUpdate,
      installMessage: snapshot.installMessage,
      lastCheckedAt: snapshot.lastCheckedAt,
      formatVersion: formatBuildLabel,
      formatLastCheckedAt: (timestamp) => formatMessageTimestamp(new Date(timestamp)),
    }),
    availableUpdate: snapshot.availableUpdate,
    errorMessage: snapshot.errorMessage,
    installProgress: snapshot.installProgress,
    lastCheckedAt: snapshot.lastCheckedAt,
    isChecking: snapshot.isChecking,
    isInstalling: snapshot.isInstalling,
    checkForUpdates,
    installUpdate,
  };
}
