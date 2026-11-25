// Ember: graphite (dark) or warm paper (light) surfaces with a single ember-orange accent.
// Halo rail tokens (faint, activeBorder, meterOn/Off, ambientGlow/Dust) are defined in both modes.
const dark = {
  background: "#090909", panel: "#0e0e0f", raised: "#161617", hover: "#1a1a1b",
  border: "#ffffff12", text: "#ececec", muted: "#8b8b8f",
  primary: "#dc5734", primaryHover: "#e96a47", primaryActive: "#c44a29", primaryText: "#ffffff",
  selection: "#202021", textSelection: "#dc573455",
  scrollbarThumb: "#ffffff1f", scrollbarThumbHover: "#ffffff38",
  success: "#3ecf72", warning: "#e0a03a", danger: "#e5484d",
  surface: "#0e0e0f", field: "#121213", answer: "#131314", agentEdge: "#dc573466",
  faint: "#5c5c60", activeBorder: "#ffffff1a", meterOn: "#d8d8d8", meterOff: "#262628",
  ambientGlow: "#ffffff14", ambientDust: "#ffffff",
  // Glass: card sheen, chip fill, top-edge highlight, depth and the accent glow.
  // Measured from the concept: a near-flat graphite card (#131313–#171717), flat chips about 9
  // steps lighter (#1c1c1c) with faint edges, a recessed account well and a faint ember glow.
  cardTop: "#181819", cardBottom: "#0a0a0b", glassTop: "#1e1e1f", glassBottom: "#1b1b1c", glassEdge: "#ffffff10",
  highlight: "#ffffff09", depth: "#00000099", chipDepth: "#00000033", glow: "#dc573455", tileTop: "#ececec", tileBottom: "#b9b9b9", rule: "#ffffff1c",
  well: "#0f0f10", wellEdge: "#ffffff0c",
};
const light = {
  background: "#efeeeb", panel: "#fbfbfa", raised: "#f1f0ed", hover: "#ebeae6",
  border: "#0000001a", text: "#1b1b1c", muted: "#68686d",
  primary: "#d9532f", primaryHover: "#c84a28", primaryActive: "#b4411f", primaryText: "#ffffff",
  selection: "#e7e6e2", textSelection: "#dc573433",
  scrollbarThumb: "#0000002a", scrollbarThumbHover: "#00000045",
  success: "#1f9d55", warning: "#b7791f", danger: "#d23f45",
  surface: "#fbfbfa", field: "#f4f3f0", answer: "#f7f6f3", agentEdge: "#dc573455",
  faint: "#a2a2a6", activeBorder: "#00000014", meterOn: "#2a2a2c", meterOff: "#dcdad5",
  ambientGlow: "#ffffffb0", ambientDust: "#00000030",
  cardTop: "#ffffff", cardBottom: "#f4f3f0", glassTop: "#ffffffe6", glassBottom: "#f3f2ef", glassEdge: "#00000012",
  highlight: "#ffffff", depth: "#00000024", chipDepth: "#0000001c", glow: "#d9532f70", tileTop: "#ffffff", tileBottom: "#dedcd8", rule: "#00000022",
  well: "#f1f0ed", wellEdge: "#00000010",
};
export const emberPalette = { light, dark };
export const emberTerminal = {
  dark: ["#0e0e0f", "#e5484d", "#3ecf72", "#e0a03a", "#7aa2f7", "#c08bd8", "#5ec4c4", "#d6d6d6",
    "#5c5c60", "#ff6b6f", "#6be39a", "#f2bf68", "#9bbcff", "#d9a9ec", "#86dede", "#ffffff"],
  light: ["#1b1b1c", "#c8333a", "#1f8a4c", "#a76b12", "#2f5fd0", "#8a43b0", "#16838a", "#d9d8d4",
    "#68686d", "#e5484d", "#25a35a", "#c4831f", "#4a78e8", "#a45ccc", "#1fa0a8", "#fbfbfa"],
};
/** Soft top glow and slow drifting dust behind the workspace (native `ambient`, palette tokens). */
export const emberAmbient = {
  // A spotlight above the Workspace rail (as in the concept) and a softer one mid-window.
  glow: [{ color: "ambientGlow", x: 0.07, y: 0, radius: 170 }, { color: "ambientGlow", x: 0.55, y: 0, radius: 120 }],
  particles: { count: 22, color: "ambientDust", minSize: 1, maxSize: 2, speed: 4, seed: 7 },
  // Dust drifting 4 px/s moves 0.2 px per frame at 20 fps: smooth, at a sixth of the redraws of a
  // 120 Hz display (every redraw repaints the whole window).
  fps: 20,
};
/** Ember without the drifting dust: static glow only, so the window is not redrawn while idle. */
export const emberAmbientStill = { glow: emberAmbient.glow };
