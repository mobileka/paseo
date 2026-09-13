import { Gift } from "lucide-react-native";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useUnistyles } from "react-native-unistyles";
import {
  type SidebarCalloutAction,
  SidebarCalloutDescriptionText,
} from "@/components/sidebar-callout";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import {
  resolveUpdateCalloutDescriptor,
  type UpdateCalloutActionDescriptor,
  type UpdateCalloutBody,
} from "@/desktop/updates/resolve-update-callout";
import { useDesktopAppUpdater } from "@/desktop/updates/use-desktop-app-updater";
import { useStableEvent } from "@/hooks/use-stable-event";
import { openChangelog } from "@/changelog";

function renderBody(body: UpdateCalloutBody, t: ReturnType<typeof useTranslation>["t"]): ReactNode {
  if (body.kind === "installing") {
    if (body.progress !== null && body.progress < 100) {
      return <UpdateProgressDescription progress={body.progress} />;
    }
    return t("desktop.updates.callout.installingDescription");
  }
  if (body.kind === "error") return body.message;
  return <UpdateAvailableDescription versionLabel={body.versionLabel ?? undefined} t={t} />;
}

function UpdateProgressDescription({ progress }: { progress: number }) {
  return (
    <>
      <ProgressBar value={progress} />
      <SidebarCalloutDescriptionText>{`${Math.round(progress)}%`}</SidebarCalloutDescriptionText>
    </>
  );
}

function materializeActions(
  actions: readonly UpdateCalloutActionDescriptor[],
  handlers: { changelog: () => void; install: () => void; retry: () => void },
): SidebarCalloutAction[] {
  return actions.map((action) => ({
    label: action.label,
    onPress: handlers[action.role],
    variant: action.variant,
    disabled: action.disabled,
  }));
}

export function UpdateCalloutSource() {
  const { t } = useTranslation();
  const callouts = useSidebarCallouts();
  const { theme } = useUnistyles();
  const {
    isDesktopApp,
    status,
    availableUpdate,
    errorMessage,
    installProgress,
    checkForUpdates,
    installUpdate,
    isInstalling,
  } = useDesktopAppUpdater();

  const install = useStableEvent(() => {
    void installUpdate();
  });
  const retry = useStableEvent(() => {
    void checkForUpdates();
  });
  useEffect(() => {
    if (!isDesktopApp) return;

    void checkForUpdates({ intent: "automatic", silent: true });
  }, [isDesktopApp, checkForUpdates]);

  useEffect(() => {
    const descriptor = resolveUpdateCalloutDescriptor({
      isDesktopApp,
      status,
      isInstalling,
      availableUpdate,
      errorMessage,
      installProgressPercent: installProgress?.percent ?? null,
    });
    if (!descriptor) return;

    return callouts.show({
      id: descriptor.id,
      dismissalKey: descriptor.dismissalKey,
      priority: descriptor.priority,
      title: descriptor.title,
      description: renderBody(descriptor.body, t),
      icon: descriptor.showGiftIcon ? (
        <Gift size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      ) : undefined,
      variant: descriptor.variant,
      actions: materializeActions(descriptor.actions, {
        changelog: openChangelog,
        install,
        retry,
      }),
      testID: descriptor.testID,
    });
  }, [
    availableUpdate,
    callouts,
    errorMessage,
    install,
    installProgress,
    isDesktopApp,
    isInstalling,
    retry,
    status,
    theme.colors.foregroundMuted,
    theme.iconSize.sm,
    t,
  ]);

  return null;
}

function UpdateAvailableDescription({
  versionLabel,
  t,
}: {
  versionLabel?: string;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <>
      <SidebarCalloutDescriptionText>
        {versionLabel
          ? t("desktop.updates.callout.versionReady", { version: versionLabel })
          : t("desktop.updates.callout.newVersionReady")}
      </SidebarCalloutDescriptionText>
      <SidebarCalloutDescriptionText>
        {t("desktop.updates.callout.restartWarning")}
      </SidebarCalloutDescriptionText>
    </>
  );
}
