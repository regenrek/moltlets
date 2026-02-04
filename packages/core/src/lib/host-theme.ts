export const HOST_THEME_COLORS = [
  "slate",
  "blue",
  "indigo",
  "violet",
  "emerald",
  "amber",
  "rose",
  "sky",
] as const;

export type HostThemeColor = (typeof HOST_THEME_COLORS)[number];

export const HOST_THEME_DEFAULT_EMOJI = "🖥️";
export const HOST_THEME_DEFAULT_COLOR: HostThemeColor = "slate";
export const HOST_THEME_DEFAULT = {
  emoji: HOST_THEME_DEFAULT_EMOJI,
  color: HOST_THEME_DEFAULT_COLOR,
} as const;

export type HostTheme = {
  emoji: string;
  color: HostThemeColor;
};

const HOST_THEME_COLOR_SET = new Set<string>(HOST_THEME_COLORS);

export function normalizeHostTheme(theme?: Partial<HostTheme> | null): HostTheme {
  const emojiRaw = typeof theme?.emoji === "string" ? theme.emoji.trim() : "";
  const emoji = emojiRaw || HOST_THEME_DEFAULT_EMOJI;
  const colorRaw = typeof theme?.color === "string" ? theme.color : "";
  const color = HOST_THEME_COLOR_SET.has(colorRaw)
    ? (colorRaw as HostThemeColor)
    : HOST_THEME_DEFAULT_COLOR;
  return { emoji, color };
}
