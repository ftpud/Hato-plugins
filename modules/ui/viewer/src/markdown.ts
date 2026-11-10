/** Keep fenced blocks intact when composing Markdown with adjacent module-owned actions. */
export interface ShellBlock { start: number; end: number; language: string; code: string }
export function shellBlocks(text: string): ShellBlock[] {
  const blocks: ShellBlock[] = [];
  let fence: { start: number; body: number; mark: string; length: number; language: string; indent: number } | null = null;
  let offset = 0;
  for (const line of text.split(/(?<=\n)/)) {
    const body = line.replace(/\r?\n$/, "");
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(body);
      if (close && close[1][0] === fence.mark && close[1].length >= fence.length) {
        if (["sh", "shell", "bash", "zsh"].includes(fence.language)) blocks.push({ start: fence.start, end: offset + line.length, language: fence.language,
          code: text.slice(fence.body, offset).split("\n").map(line => line.replace(new RegExp(`^ {0,${fence!.indent}}`), "")).join("\n") });
        fence = null;
      }
    } else {
      const open = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/.exec(body);
      if (open && !(open[2][0] === "`" && open[3].includes("`"))) fence = { start: offset, body: offset + line.length, mark: open[2][0], length: open[2].length, language: open[3].trim().split(/\s+/)[0].toLowerCase(), indent: open[1].length };
    }
    offset += line.length;
  }
  // A final unclosed fence is still a rendered code block, but omit Run until it is complete.
  return blocks;
}
