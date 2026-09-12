export function resolveNextThinkingOptionId({
  options,
  selectedId,
}: {
  options: readonly { id: string }[];
  selectedId: string | null | undefined;
}): string | null {
  if (options.length < 2) return null;

  const selectedIndex = options.findIndex((option) => option.id === selectedId);
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const nextIndex = (currentIndex + 1) % options.length;
  return options[nextIndex]?.id ?? null;
}
