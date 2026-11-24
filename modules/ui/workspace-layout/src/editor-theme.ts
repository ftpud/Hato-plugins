import { schemeNode, type SyntaxPalette, type SyntaxScheme } from "@hato/sdk/syntax-schemes";

interface ShellColors { background: string; text: string; muted: string; selection: string }

/** Use shell surfaces by default; explicit syntax-scheme colors remain user overrides. */
export function editorTheme(scheme: SyntaxScheme | undefined, palette: { light: ShellColors; dark: ShellColors }) {
  const syntax = schemeNode(scheme);
  const variant = (mode: "light" | "dark"): SyntaxPalette => ({
    tokens: syntax?.[mode]?.tokens || {},
    editor: {
      background: palette[mode].background,
      gutter: syntax?.[mode]?.editor?.background || palette[mode].background,
      foreground: palette[mode].text,
      activeLine: palette[mode].selection,
      lineNumber: palette[mode].muted,
      activeLineNumber: palette[mode].text,
      ...syntax?.[mode]?.editor,
    },
  });
  return { light: variant("light"), dark: variant("dark") };
}
