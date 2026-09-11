import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View, Text, Pressable, type PressableStateCallbackType } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { MoreHorizontal, Pencil, Undo2, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchField } from "@/components/ui/search-field";
import { Shortcut } from "@/components/ui/shortcut";
import { ShortcutSequence } from "@/components/ui/shortcut-sequence";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import { useComboCapture } from "@/hooks/use-combo-capture";
import {
  buildKeyboardShortcutHelpSections,
  getBindingIdForAction,
  getDefaultKeysForAction,
  resolveShortcutKeysForAction,
  type KeyboardShortcutHelpRow,
} from "@/keyboard/keyboard-shortcuts";
import {
  filterShortcutHelpSectionsByChord,
  searchShortcutHelpSections,
} from "@/keyboard/shortcut-help-search";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { getIsElectronRuntime } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { getDesktopHost } from "@/desktop/host";
import { ShortcutSearchDialog } from "@/screens/settings/shortcut-search-dialog";

const EMPTY_CAPTURED_COMBOS: string[] = [];

const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const ThemedPencil = withUnistyles(Pencil);
const ThemedUndo2 = withUnistyles(Undo2);
const ThemedX = withUnistyles(X);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const bindLeadingIcon = <ThemedPencil size={14} uniProps={foregroundMutedColorMapping} />;
const clearLeadingIcon = <ThemedX size={14} uniProps={foregroundMutedColorMapping} />;
const resetLeadingIcon = <ThemedUndo2 size={14} uniProps={foregroundMutedColorMapping} />;

/** Text filter and shortcut filter are mutually exclusive by construction. */
type ShortcutListFilter =
  | { kind: "none" }
  | { kind: "text"; query: string }
  | { kind: "combo"; chord: ShortcutKey[][] };

interface ShortcutRowContainerProps {
  row: KeyboardShortcutHelpRow;
  bindingId: string | null;
  displayChord: ShortcutKey[][] | null;
  hasOverride: boolean;
  hasDefault: boolean;
  isCapturing: boolean;
  capturedCombos: string[];
  heldModifiers: string | null;
  onStartCapture: (bindingId: string) => void;
  onSaveCapture: () => void;
  onCancelCapture: () => void;
  onClearOverride: (bindingId: string) => void;
  onRemoveOverride: (bindingId: string) => void;
}

function ShortcutRowContainer({
  row,
  bindingId,
  displayChord,
  hasOverride,
  hasDefault,
  isCapturing,
  capturedCombos,
  heldModifiers,
  onStartCapture,
  onSaveCapture,
  onCancelCapture,
  onClearOverride,
  onRemoveOverride,
}: ShortcutRowContainerProps) {
  const handleRebind = useCallback(() => {
    if (bindingId) onStartCapture(bindingId);
  }, [bindingId, onStartCapture]);

  const handleClear = useCallback(() => {
    if (bindingId) onClearOverride(bindingId);
  }, [bindingId, onClearOverride]);

  const handleReset = useCallback(() => {
    if (bindingId) onRemoveOverride(bindingId);
  }, [bindingId, onRemoveOverride]);

  return (
    <ShortcutRow
      row={row}
      bindingId={bindingId}
      displayChord={displayChord}
      hasOverride={hasOverride}
      hasDefault={hasDefault}
      isCapturing={isCapturing}
      capturedCombos={capturedCombos}
      heldModifiers={heldModifiers}
      onRebind={handleRebind}
      onDone={onSaveCapture}
      onCancel={onCancelCapture}
      onClear={handleClear}
      onReset={handleReset}
    />
  );
}

function ShortcutRowKeys({
  displayChord,
  isCapturing,
  capturedCombos,
  heldModifiers,
}: {
  displayChord: ShortcutKey[][] | null;
  isCapturing: boolean;
  capturedCombos: string[];
  heldModifiers: string | null;
}) {
  const { t } = useTranslation();

  if (isCapturing) {
    return <ShortcutSequence chord={capturedCombos} heldModifiers={heldModifiers} />;
  }
  if (displayChord === null) {
    return <Text style={styles.unassignedText}>{t("settings.shortcuts.unassigned")}</Text>;
  }
  return <Shortcut chord={displayChord} />;
}

function ShortcutActionsMenu({
  row,
  bindLabel,
  showClear,
  showReset,
  onRebind,
  onClear,
  onReset,
}: {
  row: KeyboardShortcutHelpRow;
  bindLabel: "bind" | "rebind";
  showClear: boolean;
  showReset: boolean;
  onRebind: () => void;
  onClear: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const triggerStyle = useCallback(
    ({
      pressed,
      hovered,
      open,
    }: PressableStateCallbackType & { hovered?: boolean; open?: boolean }) => [
      styles.menuButton,
      (hovered || open) && styles.menuButtonHovered,
      pressed && styles.menuButtonPressed,
    ],
    [],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        hitSlop={8}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("settings.shortcuts.actions.menu", { name: t(row.labelKey) })}
        testID={`shortcut-actions-${row.id}`}
      >
        {({ hovered, open }) => (
          <ThemedMoreHorizontal
            size={14}
            uniProps={hovered || open ? foregroundColorMapping : foregroundMutedColorMapping}
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        <DropdownMenuItem
          leading={bindLeadingIcon}
          onSelect={onRebind}
          testID={`shortcut-bind-${row.id}`}
        >
          {t(`settings.shortcuts.actions.${bindLabel}`)}
        </DropdownMenuItem>
        {showClear && (
          <DropdownMenuItem
            leading={clearLeadingIcon}
            onSelect={onClear}
            testID={`shortcut-clear-${row.id}`}
          >
            {t("settings.shortcuts.actions.clear")}
          </DropdownMenuItem>
        )}
        {showReset && (
          <DropdownMenuItem
            leading={resetLeadingIcon}
            onSelect={onReset}
            testID={`shortcut-reset-${row.id}`}
          >
            {t("settings.shortcuts.actions.reset")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ShortcutRow({
  row,
  bindingId,
  displayChord,
  hasOverride,
  hasDefault,
  isCapturing,
  capturedCombos,
  heldModifiers,
  onRebind,
  onDone,
  onCancel,
  onClear,
  onReset,
}: {
  row: KeyboardShortcutHelpRow;
  bindingId: string | null;
  displayChord: ShortcutKey[][] | null;
  hasOverride: boolean;
  hasDefault: boolean;
  isCapturing: boolean;
  capturedCombos: string[];
  heldModifiers: string | null;
  onRebind: () => void;
  onDone: () => void;
  onCancel: () => void;
  onClear: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const rowStyle = useMemo(() => [styles.row, isCapturing && styles.rowCapturing], [isCapturing]);

  const isBindable = bindingId !== null;
  const showDone = isCapturing && capturedCombos.length > 0;
  const showClear = displayChord !== null;
  // Reset restores the default, so it is only meaningful when there is a
  // default to restore. A binding that ships without one would otherwise show a
  // Reset that lands on the same "Not set" state Clear already produced.
  const showReset = hasOverride && hasDefault;
  // Nothing is bound in the unassigned state, so there is nothing to *re*-bind.
  const bindLabel = displayChord === null ? "bind" : "rebind";

  return (
    <View style={rowStyle}>
      <Text style={styles.rowLabel}>{t(row.labelKey)}</Text>
      <View style={styles.rowActions}>
        <View style={styles.rowKeys}>
          <ShortcutRowKeys
            displayChord={displayChord}
            isCapturing={isCapturing}
            capturedCombos={capturedCombos}
            heldModifiers={heldModifiers}
          />
        </View>
        {isCapturing ? (
          <>
            {showDone && (
              <Button variant="ghost" size="sm" onPress={onDone}>
                {t("settings.shortcuts.actions.done")}
              </Button>
            )}
            {isBindable && (
              <Button variant="ghost" size="sm" onPress={onCancel}>
                {t("settings.shortcuts.actions.cancel")}
              </Button>
            )}
          </>
        ) : (
          // Fixed slot, occupied or not, so the keys column keeps one rail on
          // every row instead of sliding with whatever actions the row offers.
          <View style={styles.menuSlot}>
            {isBindable && (
              <ShortcutActionsMenu
                row={row}
                bindLabel={bindLabel}
                showClear={showClear}
                showReset={showReset}
                onRebind={onRebind}
                onClear={onClear}
                onReset={onReset}
              />
            )}
          </View>
        )}
      </View>
    </View>
  );
}

export function KeyboardShortcutsSection() {
  const { t } = useTranslation();
  const [capturingBindingId, setCapturingBindingId] = useState<string | null>(null);
  const {
    combos: capturedCombos,
    heldModifiers: capturedHeldModifiers,
    reset: resetCapture,
  } = useComboCapture(capturingBindingId !== null);
  const [query, setQuery] = useState("");
  const [comboChord, setComboChord] = useState<ShortcutKey[][] | null>(null);
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);
  const { overrides, hasOverrides, setOverride, clearOverride, removeOverride, resetAll } =
    useKeyboardShortcutOverrides();
  const setCapturingShortcut = useKeyboardShortcutsStore((s) => s.setCapturingShortcut);
  const capturing = useKeyboardShortcutsStore((s) => s.capturingShortcut);

  const isFocused = useIsFocused();
  const shortcutOs = getShortcutOs();
  const isMac = shortcutOs === "mac";
  const isDesktopApp = getIsElectronRuntime();
  const platform = useMemo(() => ({ isMac, isDesktop: isDesktopApp }), [isDesktopApp, isMac]);
  const sections = buildKeyboardShortcutHelpSections(platform);

  const cancelCapture = useCallback(() => {
    resetCapture();
    setCapturingBindingId(null);
    setCapturingShortcut(false);
  }, [resetCapture, setCapturingShortcut]);

  const startCapture = useCallback(
    (bindingId: string) => {
      resetCapture();
      setCapturingBindingId(bindingId);
      setCapturingShortcut(true);
    },
    [resetCapture, setCapturingShortcut],
  );

  const saveCapture = useCallback(() => {
    if (capturingBindingId === null || capturedCombos.length === 0) {
      return;
    }
    void setOverride(capturingBindingId, capturedCombos.join(" "));
    cancelCapture();
  }, [capturingBindingId, capturedCombos, setOverride, cancelCapture]);

  useEffect(() => {
    if (!isFocused && capturingBindingId !== null) {
      cancelCapture();
    }
  }, [isFocused, capturingBindingId, cancelCapture]);

  useEffect(() => {
    return () => {
      setCapturingShortcut(false);
    };
  }, [setCapturingShortcut]);

  // Suppress desktop zoom accelerators while capturing so combos like Cmd+- are
  // recorded instead of zooming the window. No-op outside Electron.
  useEffect(() => {
    if (isNative || !capturing) return;
    const menu = getDesktopHost()?.menu;
    void menu?.setCapturingShortcut?.(true);
    return () => {
      void menu?.setCapturingShortcut?.(false);
    };
  }, [capturing]);

  const handleResetAll = useCallback(() => void resetAll(), [resetAll]);
  const handleClearOverride = useCallback(
    (bindingId: string) => void clearOverride(bindingId),
    [clearOverride],
  );
  const handleRemoveOverride = useCallback(
    (bindingId: string) => void removeOverride(bindingId),
    [removeOverride],
  );

  // Typing always switches to the text filter; confirming the dialog always
  // switches to the chord filter. The two cannot be active together.
  const handleFilterTextChange = useCallback((text: string) => {
    setComboChord(null);
    setQuery(text);
  }, []);

  const clearShortcutFilter = useCallback(() => setComboChord(null), []);

  const openSearchDialog = useCallback(() => {
    if (capturingBindingId !== null) {
      cancelCapture();
    }
    setIsSearchDialogOpen(true);
  }, [capturingBindingId, cancelCapture]);

  const handleShortcutSearch = useCallback((chord: ShortcutKey[][]) => {
    setIsSearchDialogOpen(false);
    setQuery("");
    setComboChord(chord);
  }, []);

  const closeSearchDialog = useCallback(() => setIsSearchDialogOpen(false), []);

  const filter = useMemo<ShortcutListFilter>(() => {
    if (comboChord) return { kind: "combo", chord: comboChord };
    if (query) return { kind: "text", query };
    return { kind: "none" };
  }, [comboChord, query]);

  const visibleSections = useMemo(() => {
    switch (filter.kind) {
      case "none":
        return sections;
      case "text":
        return searchShortcutHelpSections({
          sections,
          query: filter.query,
          translate: t,
          shortcutOs,
        });
      case "combo":
        return filterShortcutHelpSectionsByChord({
          sections,
          chord: filter.chord,
          overrides,
          platform,
        });
    }
  }, [filter, sections, t, shortcutOs, overrides, platform]);

  if (isNative) {
    return (
      <SettingsSection title={t("settings.sections.shortcuts")}>
        <View style={[settingsStyles.card, styles.emptyCard]}>
          <Text style={styles.emptyText}>{t("settings.shortcuts.unavailableOnMobile")}</Text>
        </View>
      </SettingsSection>
    );
  }

  const resetAllButton = hasOverrides ? (
    <Button variant="ghost" size="sm" onPress={handleResetAll}>
      {t("settings.shortcuts.actions.resetAll")}
    </Button>
  ) : undefined;

  return (
    <>
      <View style={styles.filterBar}>
        <SearchField
          value={query}
          onChangeText={handleFilterTextChange}
          placeholder={t("settings.shortcuts.searchPlaceholder")}
          clearAccessibilityLabel={t("settings.shortcuts.filter.clear")}
          resetKey={comboChord ? "combo" : "text"}
          testID="shortcuts-filter-search"
          clearTestID="shortcuts-filter-clear"
        />
        <Button variant="ghost" size="sm" onPress={openSearchDialog}>
          {t("settings.shortcuts.filter.byShortcut")}
        </Button>
      </View>
      {comboChord ? (
        <View style={styles.filterChip}>
          <Shortcut chord={comboChord} />
          <Pressable
            onPress={clearShortcutFilter}
            accessibilityRole="button"
            accessibilityLabel={t("settings.shortcuts.filter.clear")}
            hitSlop={8}
            testID="shortcuts-filter-reset"
          >
            <ThemedX size={14} uniProps={foregroundMutedColorMapping} />
          </Pressable>
        </View>
      ) : null}
      {visibleSections.length === 0 ? (
        <SettingsSection title={t("settings.sections.shortcuts")}>
          <View style={[settingsStyles.card, styles.emptyCard]}>
            <Text style={styles.emptyText}>{t("common.empty.noResults")}</Text>
          </View>
        </SettingsSection>
      ) : (
        visibleSections.map(function (section, sectionIndex) {
          return (
            <SettingsSection
              key={section.id}
              title={t(section.titleKey)}
              trailing={sectionIndex === 0 ? resetAllButton : undefined}
            >
              <View style={settingsStyles.card}>
                {section.rows.map(function (row, index) {
                  const bindingId = getBindingIdForAction(row.id, platform);
                  const displayChord = resolveShortcutKeysForAction(row.id, overrides, platform);
                  // `in`, not a truthiness check: an unassigned shortcut stores
                  // null, and Reset has to stay available to undo it.
                  const hasOverride = bindingId !== null && bindingId in overrides;
                  // A binding authored with `combo: ""` has nothing to reset to.
                  const hasDefault = getDefaultKeysForAction(row.id, platform) !== null;

                  return (
                    <View key={row.id}>
                      <ShortcutRowContainer
                        row={row}
                        bindingId={bindingId}
                        displayChord={displayChord}
                        hasOverride={hasOverride}
                        hasDefault={hasDefault}
                        isCapturing={capturingBindingId === bindingId}
                        capturedCombos={
                          capturingBindingId === bindingId ? capturedCombos : EMPTY_CAPTURED_COMBOS
                        }
                        heldModifiers={
                          capturingBindingId === bindingId ? capturedHeldModifiers : null
                        }
                        onStartCapture={startCapture}
                        onSaveCapture={saveCapture}
                        onCancelCapture={cancelCapture}
                        onClearOverride={handleClearOverride}
                        onRemoveOverride={handleRemoveOverride}
                      />
                      {index < section.rows.length - 1 && <View style={styles.separator} />}
                    </View>
                  );
                })}
              </View>
            </SettingsSection>
          );
        })
      )}
      {isSearchDialogOpen ? (
        <ShortcutSearchDialog onSearch={handleShortcutSearch} onClose={closeSearchDialog} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  rowCapturing: {
    backgroundColor: theme.colors.surface2,
  },
  rowLabel: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  rowKeys: {
    alignItems: "flex-end",
  },
  menuSlot: {
    width: 32,
    height: 32,
  },
  menuButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  menuButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  menuButtonPressed: {
    backgroundColor: theme.colors.surface3,
  },
  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[4],
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    marginBottom: theme.spacing[4],
  },
  unassignedText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  separator: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
  emptyCard: {
    padding: theme.spacing[4],
  },
  emptyText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
}));
