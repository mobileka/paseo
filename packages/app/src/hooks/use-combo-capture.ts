import { useCallback, useEffect, useState } from "react";
import { heldModifiersFromEvent, keyboardEventToComboString } from "@/keyboard/shortcut-string";
import { isNative } from "@/constants/platform";

export interface ComboCapture {
  /** Recorded combos, in canonical "Cmd+K" spelling, in press order. */
  combos: string[];
  /** Modifiers currently held without a key, for the live display. */
  heldModifiers: string | null;
  reset: () => void;
}

/**
 * Records the chords pressed while `active`. The capture-phase window listener
 * swallows the keystrokes so they never reach the app's global shortcut
 * handler; Backspace pops the last combo and modifier-only presses update the
 * held-modifier display. Web only — callers gate the surfaces that use it.
 */
export function useComboCapture(active: boolean): ComboCapture {
  const [combos, setCombos] = useState<string[]>([]);
  const [heldModifiers, setHeldModifiers] = useState<string | null>(null);

  const reset = useCallback(() => {
    setCombos([]);
    setHeldModifiers(null);
  }, []);

  useEffect(() => {
    if (isNative || !active) return;

    function handleKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();

      const key = event.key ?? "";
      if (key === "Backspace") {
        setCombos((current) => (current.length > 0 ? current.slice(0, -1) : current));
        return;
      }

      const comboString = keyboardEventToComboString(event);
      if (comboString === null) {
        setHeldModifiers(heldModifiersFromEvent(event));
        return;
      }

      setHeldModifiers(null);
      setCombos((current) => [...current, comboString]);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [active]);

  return { combos, heldModifiers, reset };
}
