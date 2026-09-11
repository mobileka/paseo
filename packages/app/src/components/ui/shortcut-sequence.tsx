import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Shortcut } from "@/components/ui/shortcut";
import { comboStringToShortcutKeys } from "@/keyboard/shortcut-string";

/**
 * The live display while a capture is in progress: recorded combos as badges,
 * plus any modifiers held without a key yet, or the prompt before the first
 * press. Shared by the settings row capture and the search-by-shortcut dialog.
 */
export function ShortcutSequence({
  chord,
  heldModifiers,
}: {
  chord: string[] | null;
  heldModifiers: string | null;
}) {
  const { t } = useTranslation();
  const displayChord = useMemo(() => {
    const combos = [...(chord ?? [])];
    if (heldModifiers) {
      combos.push(heldModifiers);
    }
    return combos.map(comboStringToShortcutKeys);
  }, [chord, heldModifiers]);

  if ((!chord || chord.length === 0) && !heldModifiers) {
    return <Text style={styles.capturingText}>{t("settings.shortcuts.capturePrompt")}</Text>;
  }

  return <Shortcut chord={displayChord} />;
}

const styles = StyleSheet.create((theme) => ({
  capturingText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
}));
