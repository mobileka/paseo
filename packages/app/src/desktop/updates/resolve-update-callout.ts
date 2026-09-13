import type { DesktopAppUpdateStatus } from "@/desktop/updates/use-desktop-app-updater";
import { formatBuildLabel, normalizeBuildCommit } from "@/desktop/updates/desktop-updates";
import { i18n } from "@/i18n/i18next";

export type UpdateCalloutBody =
  | { kind: "available"; versionLabel: string | null }
  | { kind: "installing"; progress: number | null }
  | { kind: "error"; message: string };

export type UpdateCalloutActionRole = "changelog" | "install" | "retry";

export interface UpdateCalloutActionDescriptor {
  role: UpdateCalloutActionRole;
  label: string;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}

export interface UpdateCalloutDescriptor {
  id: "desktop-update";
  dismissalKey: string;
  priority: number;
  title: string;
  body: UpdateCalloutBody;
  showGiftIcon: boolean;
  variant: "default" | "error";
  actions: UpdateCalloutActionDescriptor[];
  testID: "update-callout";
}

export interface ResolveUpdateCalloutInput {
  isDesktopApp: boolean;
  status: DesktopAppUpdateStatus;
  isInstalling: boolean;
  availableUpdate: { latestVersion?: string | null; targetCommit?: string | null } | null;
  errorMessage: string | null;
  installProgressPercent?: number | null;
}

export function resolveUpdateCalloutDescriptor(
  input: ResolveUpdateCalloutInput,
): UpdateCalloutDescriptor | null {
  if (!input.isDesktopApp) return null;
  if (input.status !== "available" && input.status !== "installing" && input.status !== "error") {
    return null;
  }

  const isError = input.status === "error";
  const isInstalling = input.isInstalling;
  const isAvailable = !isInstalling && !isError;

  const latestVersion = input.availableUpdate?.latestVersion ?? null;
  const targetCommit = normalizeBuildCommit(input.availableUpdate?.targetCommit);
  // The commit is part of the key so a new local build re-surfaces the callout
  // even though the fork keeps the same version number.
  const dismissalKey = ["desktop-update", input.status, latestVersion ?? "unknown", targetCommit]
    .filter((part): part is string => part !== null)
    .join(":");

  let title: string;
  let body: UpdateCalloutBody;
  if (isInstalling) {
    title = i18n.t("desktop.updates.callout.installingTitle");
    body = { kind: "installing", progress: input.installProgressPercent ?? null };
  } else if (isError) {
    title = i18n.t("desktop.updates.callout.failedTitle");
    body = {
      kind: "error",
      message: input.errorMessage ?? i18n.t("desktop.updates.callout.genericError"),
    };
  } else {
    title = i18n.t("desktop.updates.callout.availableTitle");
    const versionLabel =
      latestVersion || targetCommit ? formatBuildLabel(latestVersion, targetCommit) : null;
    body = { kind: "available", versionLabel };
  }

  const actions: UpdateCalloutActionDescriptor[] = [
    { role: "changelog", label: i18n.t("desktop.updates.callout.whatsNew") },
  ];
  if (isError) {
    actions.push({ role: "retry", label: i18n.t("common.actions.retry"), variant: "primary" });
  } else {
    actions.push({
      role: "install",
      label: isInstalling
        ? i18n.t("desktop.updates.callout.installingAction")
        : i18n.t("desktop.updates.callout.installAndRestart"),
      variant: "primary",
      disabled: isInstalling,
    });
  }

  return {
    id: "desktop-update",
    dismissalKey,
    priority: 200,
    title,
    body,
    showGiftIcon: isAvailable,
    variant: isError ? "error" : "default",
    actions,
    testID: "update-callout",
  };
}
