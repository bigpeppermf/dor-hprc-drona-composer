/**
 * Shared design tokens + small style fragments for the Environment Builder, so
 * the canvas / property panel / preview / save bar read as one cohesive tool.
 * TAMU maroon primary; neutral surfaces; soft cards.
 */
// Theme-driven tokens reference the site CSS variables (set by the navbar
// switcher on <html data-theme>), so the builder follows the active theme
// automatically. A few tokens stay literal where they read well on any theme.
export const T = {
  maroon: "var(--accent)",
  accent: "var(--accent)",
  accentFg: "var(--accent-fg)",
  ink: "var(--app-text)",
  sub: "var(--text-sub)",
  hint: "var(--text-sub)",
  line: "var(--border)",
  surface: "var(--surface)",
  surfaceMuted: "var(--surface-muted)",
  surfaceCode: "var(--surface-code)",
  ok: "#1a9e3e",
  err: "#e0556e",
  radius: 8,
  shadow: "0 1px 3px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.10)",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

/** Read a site theme CSS variable as a concrete color (for Blockly/SVG, which
 *  can't resolve var() in attributes). Falls back to the given default. */
export function cssVar(name, fallback) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return (v && v.trim()) || fallback;
}

/** A white card with soft border + shadow, column flex, clipped corners. */
export const card = {
  display: "flex",
  flexDirection: "column",
  background: T.surface,
  border: `1px solid ${T.line}`,
  borderRadius: T.radius,
  boxShadow: T.shadow,
  overflow: "hidden",
};

/** Maroon panel header bar. */
export const panelHeader = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0.55rem 0.85rem",
  background: T.accent,
  color: T.accentFg,
  fontWeight: 700,
  fontSize: "0.72rem",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  flex: "0 0 auto",
};

/** Text input / select. */
export const input = {
  width: "100%",
  padding: "0.45rem 0.55rem",
  border: `1px solid ${T.line}`,
  borderRadius: 6,
  fontSize: "0.85rem",
  color: T.ink,
  background: T.surface,
  boxSizing: "border-box",
  outline: "none",
};

/** Monospace code block for generated-file previews. */
export const codeBlock = {
  margin: 0,
  padding: "0.85rem",
  fontSize: "0.8rem",
  lineHeight: 1.5,
  fontFamily: T.mono,
  whiteSpace: "pre-wrap",
  color: T.ink,
  background: T.surfaceCode,
  borderRadius: 6,
};

export const hint = {
  color: T.hint,
  fontSize: "0.85rem",
  lineHeight: 1.5,
};

/** Solid maroon button; pass enabled=false to mute it. */
export function solidButton(enabled = true) {
  return {
    border: "none",
    borderRadius: 6,
    padding: "0.4rem 0.9rem",
    fontSize: "0.8rem",
    fontWeight: 700,
    cursor: enabled ? "pointer" : "not-allowed",
    background: enabled ? T.accent : "var(--mosaic-color-border-strong)",
    color: enabled ? T.accentFg : "var(--mosaic-color-text-muted)",
    transition: "background 0.15s ease",
  };
}
