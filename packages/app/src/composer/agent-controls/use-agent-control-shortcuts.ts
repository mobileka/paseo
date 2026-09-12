import { useCallback, useRef } from "react";
import { useComposerKeyboardScope } from "@/composer/keyboard-scope";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { resolveNextThinkingOptionId } from "@/composer/agent-controls/thinking";

/**
 * Opens a model picker surface on the composer's Ctrl+X Ctrl+M chord. The
 * picker passes its own open path; `enabled` gates the registration so only
 * the composer toolbar ever answers the action (other surfaces keep silent,
 * leaving the shortcut free).
 */
export function useModelPickShortcut({
  enabled,
  disabled,
  isOpen,
  open,
}: {
  enabled: boolean;
  disabled: boolean;
  isOpen: boolean;
  open: () => void;
}): void {
  const { isActiveComposer } = useComposerKeyboardScope();
  const handlerIdRef = useRef(`model-pick:${Math.random().toString(36).slice(2)}`);
  useKeyboardActionHandler({
    handlerId: handlerIdRef.current,
    actions: ["message-input.model-pick"],
    enabled: enabled && isActiveComposer && !disabled,
    priority: 200,
    handle: (action: KeyboardActionDefinition): boolean => {
      if (action.id !== "message-input.model-pick") return false;
      if (disabled || isOpen) return false;
      open();
      return true;
    },
  });
}

/**
 * Advances the effort (thinking) selection by one on Ctrl+X Ctrl+Tab —
 * the same cycle interaction Shift+Tab gives agent modes.
 */
export function useThinkingCycleShortcut({
  disabled,
  options,
  selectedId,
  onSelect,
}: {
  disabled: boolean;
  options: readonly { id: string }[];
  selectedId: string | null | undefined;
  onSelect: ((thinkingOptionId: string) => void) | undefined;
}): void {
  const { isActiveComposer } = useComposerKeyboardScope();
  const handlerIdRef = useRef(`thinking-cycle:${Math.random().toString(36).slice(2)}`);
  const handle = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      if (action.id !== "message-input.thinking-cycle") return false;
      if (disabled || !onSelect) return false;
      const nextThinkingOptionId = resolveNextThinkingOptionId({ options, selectedId });
      if (!nextThinkingOptionId) return false;
      onSelect(nextThinkingOptionId);
      return true;
    },
    [disabled, onSelect, options, selectedId],
  );
  useKeyboardActionHandler({
    handlerId: handlerIdRef.current,
    actions: ["message-input.thinking-cycle"],
    enabled: isActiveComposer && !disabled && options.length > 1,
    priority: 200,
    handle,
  });
}
