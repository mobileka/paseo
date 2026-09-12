import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { ShortcutSequence } from "@/components/ui/shortcut-sequence";
import { Button } from "@/components/ui/button";
import { useComboCapture } from "@/hooks/use-combo-capture";
import { comboStringToShortcutKeys } from "@/keyboard/shortcut-string";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import type { ShortcutKey } from "@/utils/format-shortcut";

const SNAP_POINTS = ["35%"];

/**
 * The "search by shortcut" capture dialog: press a chord, confirm, and the
 * settings list narrows to the binding that fires it. Same capture mechanics
 * as rebinding a row, and the same store flag, so global shortcuts and the
 * desktop menu accelerators stand down while it is open.
 */
export function ShortcutSearchDialog({
  onSearch,
  onClose,
}: {
  onSearch: (chord: ShortcutKey[][]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const setCapturingShortcut = useKeyboardShortcutsStore((s) => s.setCapturingShortcut);
  const { combos, heldModifiers, reset } = useComboCapture(true);

  useEffect(() => {
    setCapturingShortcut(true);
    return () => setCapturingShortcut(false);
  }, [setCapturingShortcut]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleDone = useCallback(() => {
    if (combos.length === 0) return;
    onSearch(combos.map(comboStringToShortcutKeys));
  }, [combos, onSearch]);

  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.shortcuts.filter.byShortcut") }),
    [t],
  );

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="ghost" size="sm" onPress={handleClose}>
          {t("settings.shortcuts.actions.cancel")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={handleDone}
          disabled={combos.length === 0}
          testID="shortcut-search-dialog-done"
        >
          {t("settings.shortcuts.actions.done")}
        </Button>
      </View>
    ),
    [handleClose, handleDone, combos.length, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={handleClose}
      testID="shortcut-search-dialog"
      snapPoints={SNAP_POINTS}
      desktopMaxWidth={360}
      footer={footer}
    >
      <View testID="shortcut-search-dialog-content" style={styles.content}>
        <ShortcutSequence chord={combos} heldModifiers={heldModifiers} />
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[6],
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
