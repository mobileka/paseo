import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export interface ProgressBarProps {
  value: number;
}

export function ProgressBar({ value }: ProgressBarProps) {
  const percent = Math.min(100, Math.max(0, Math.round(value)));
  const width: `${number}%` = `${percent}%`;
  const fillStyle = useMemo(() => [styles.fill, { width }], [width]);
  const accessibilityValue = useMemo(() => ({ now: percent }), [percent]);
  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityValue={accessibilityValue}
    >
      <View style={fillStyle} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  track: {
    height: 4,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.full,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.full,
  },
}));
