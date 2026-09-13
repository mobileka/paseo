import { memo, useMemo } from "react";
import { Text, View } from "react-native";
import { Gift } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { normalizeBuildCommit } from "@/desktop/updates/desktop-updates";
import { useChangelog, type ChangelogEntry, type ChangelogState } from "./changelog-source";
import { useRevealedReleases } from "./use-revealed-releases";
import { formatChangelogDate } from "./parse-changelog";

const ThemedGift = withUnistyles(Gift);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const sheetLeadingIcon = <ThemedGift size={ICON_SIZE.md} uniProps={mutedColorMapping} />;

interface ChangelogSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function ChangelogSheet({ visible, onClose }: ChangelogSheetProps) {
  const { t } = useTranslation();
  const { state, reload } = useChangelog(visible);
  const { count, showMore } = useRevealedReleases(visible && state.status === "ready");

  const header: SheetHeader = useMemo(
    () => ({
      title: t("changelog.title"),
      leading: sheetLeadingIcon,
    }),
    [t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      snapPoints={SNAP_POINTS}
      desktopMaxWidth={620}
      desktopHeight="85%"
      testID="changelog-sheet"
    >
      <ChangelogBody state={state} shownReleases={count} onShowMore={showMore} onRetry={reload} />
    </AdaptiveModalSheet>
  );
}

const SNAP_POINTS = ["85%", "95%"];

interface ChangelogBodyProps {
  state: ChangelogState;
  shownReleases: number;
  onShowMore: () => void;
  onRetry: () => void;
}

function ChangelogBody({ state, shownReleases, onShowMore, onRetry }: ChangelogBodyProps) {
  const { t } = useTranslation();

  if (state.status === "loading") {
    return (
      <View style={styles.centered}>
        <ThemedLoadingSpinner size="large" uniProps={mutedColorMapping} />
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View style={styles.centered}>
        <Alert
          variant="error"
          title={t("changelog.error.title")}
          description={t("changelog.error.description")}
          testID="changelog-error"
        >
          <Button variant="outline" size="sm" onPress={onRetry} testID="changelog-retry">
            {t("common.actions.retry")}
          </Button>
        </Alert>
      </View>
    );
  }

  if (state.entries.length === 0) {
    return (
      <View style={styles.centered}>
        <Alert
          variant="info"
          title={t("changelog.empty.title")}
          description={t("changelog.empty.description")}
          testID="changelog-empty"
        />
      </View>
    );
  }

  const visibleEntries = state.entries.slice(0, shownReleases);
  const localChanges = state.entries.find((entry) => entry.localChanges)?.localChanges ?? null;

  return (
    <View style={styles.releaseList}>
      {localChanges ? <LocalChangesBlock text={localChanges} /> : null}
      {visibleEntries.map((entry) => (
        <ReleaseView key={`${entry.version}:${entry.date}`} entry={entry} />
      ))}
      {state.entries.length > visibleEntries.length ? (
        <Button
          variant="ghost"
          onPress={onShowMore}
          style={styles.showMore}
          testID="changelog-show-more"
        >
          {t("changelog.showMore")}
        </Button>
      ) : null}
    </View>
  );
}

function LocalChangesBlock({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.localChanges} testID="changelog-local-changes">
      <Text style={styles.localChangesTitle}>{t("changelog.localChanges")}</Text>
      <MarkdownRenderer text={text} compact />
    </View>
  );
}

interface ReleaseViewProps {
  entry: ChangelogEntry;
}

const ReleaseView = memo(function ReleaseView({ entry }: ReleaseViewProps) {
  const { t } = useTranslation();
  const date = formatChangelogDate(entry.date);
  const commit = normalizeBuildCommit(entry.commit);

  return (
    <View style={styles.release} testID={`changelog-release-${entry.version}`}>
      <View style={styles.releaseHeading}>
        <Text style={styles.version}>{entry.version}</Text>
        {commit ? <Text style={styles.commit}>{commit}</Text> : null}
        {entry.isRunning ? <StatusBadge label={t("changelog.installed")} /> : null}
        <View style={styles.headingSpacer} />
        {date ? <Text style={styles.date}>{date}</Text> : null}
      </View>
      {entry.sections.map((section) => (
        <View key={`${section.title ?? ""}:${section.body}`} style={styles.section}>
          {section.title ? <Text style={styles.sectionTitle}>{section.title}</Text> : null}
          {section.body ? <MarkdownRenderer text={section.body} compact /> : null}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  centered: {
    flex: 1,
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
  },
  releaseList: {
    gap: theme.spacing[8],
    paddingBottom: theme.spacing[4],
  },
  localChanges: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  localChangesTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  release: {
    gap: theme.spacing[4],
  },
  releaseHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  headingSpacer: {
    flex: 1,
  },
  version: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  commit: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
  },
  date: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  section: {
    gap: theme.spacing[2],
  },
  sectionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  showMore: {
    alignSelf: "center",
  },
}));
