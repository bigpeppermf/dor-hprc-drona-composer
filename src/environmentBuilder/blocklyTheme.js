import * as Blockly from "blockly";
import { cssVar } from "./theme";

/**
 * Build a Blockly theme that matches the active site theme (light / maroon /
 * dark). Chrome colors (workspace, toolbox, flyout) come from the site CSS
 * variables; the block palette is a refined, slightly-muted set chosen to read
 * well on each backdrop — much less "default Blockly" than the stock hues.
 *
 * Themes are cache-keyed by name, so we suffix a counter to force a fresh theme
 * object whenever the user switches (otherwise setTheme would no-op).
 */
let counter = 0;

const PALETTE = {
  light: {
    field_block: "#4a76c4",
    container_block: "#2f9e7f",
    map_block: "#c0892e",
    mappart_block: "#c0633e",
    template_block: "#7a5bb0",
    driver_block: "#b24a7e",
  },
  dark: {
    field_block: "#5b86d6",
    container_block: "#36b08e",
    map_block: "#d39a3e",
    mappart_block: "#d2724e",
    template_block: "#8c6cc4",
    driver_block: "#c45a90",
  },
};

export function currentThemeName() {
  return (
    (typeof document !== "undefined" &&
      document.documentElement.getAttribute("data-theme")) ||
    "light"
  );
}

export function makeBlocklyTheme() {
  const isLight = currentThemeName() === "light";
  const palette = isLight ? PALETTE.light : PALETTE.dark;

  const blockStyles = {};
  Object.entries(palette).forEach(([name, colour]) => {
    blockStyles[name] = { colourPrimary: colour };
  });

  const surface = cssVar("--surface", isLight ? "#fff" : "#252526");
  const surfaceMuted = cssVar("--surface-muted", isLight ? "#f7f7f8" : "#2a2a2b");
  const text = cssVar("--app-text", isLight ? "#2a2a2a" : "#e6e6e6");
  const canvas = cssVar("--canvas-bg", isLight ? "#f7f7f8" : "#1e1e1e");

  const componentStyles = {
    workspaceBackgroundColour: canvas,
    toolboxBackgroundColour: surface,
    toolboxForegroundColour: text,
    flyoutBackgroundColour: surfaceMuted,
    flyoutForegroundColour: text,
    flyoutOpacity: 1,
    scrollbarColour: isLight ? "#c9c9cf" : "#55555a",
    scrollbarOpacity: 0.6,
    insertionMarkerColour: text,
    insertionMarkerOpacity: 0.4,
    cursorColour: text,
    selectedGlowColour: cssVar("--accent", "#500000"),
  };

  counter += 1;
  return Blockly.Theme.defineTheme(`drona-${currentThemeName()}-${counter}`, {
    base: Blockly.Themes.Classic,
    blockStyles,
    componentStyles,
    fontStyle: { family: '"Open Sans", system-ui, sans-serif', size: 11 },
    startHats: false,
  });
}
