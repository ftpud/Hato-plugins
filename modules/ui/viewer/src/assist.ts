// IDEA-style presentation of language-server completions and hovers. Pure functions: the viewer
// feeds them server results; the native editor renders the shaped data.

// ---- Completions ------------------------------------------------------------------------------
// The native menu shows `label`, then `labelDetails.detail` (muted parameters), with
// `labelDetails.description` right-aligned; `data.presentation` supplies the kind icon and bold.

/** LSP CompletionItemKind → icon letter and color. */
const KIND_ICONS: Record<number, [string, string]> = {
  2: ["m", "#e0675c"], 3: ["m", "#e0675c"], 4: ["m", "#e0675c"], // method, function, constructor
  5: ["f", "#e39b38"], 10: ["f", "#e39b38"], // field, property
  6: ["v", "#8a94a6"], 7: ["c", "#4a8fe0"], 8: ["i", "#3dab6c"], 9: ["p", "#8a94a6"],
  13: ["e", "#a77bd6"], 20: ["e", "#a77bd6"], 21: ["k", "#a77bd6"], 22: ["s", "#4a8fe0"],
  14: ["k", "#8a94a6"], 15: ["t", "#8a94a6"], 25: ["T", "#4a8fe0"],
};
const utf8 = new TextEncoder();
const utf8Length = (text: string) => utf8.encode(text).length;
const simpleType = (type: string) => type.replace(/<.*$/s, "").replace(/\[\]/g, "").trim().split(".").pop() || "";

/** Declaring type of a member from its server detail ("Helper.get(UUID) : String" → "Helper"). */
export function declaringType(item: any): string | null {
  const m = /^([\w$.]+(?:<[^>]*>)?)\.[\w$]+\s*(?:\(|:|$)/.exec(String(item?.detail ?? ""));
  return m ? simpleType(m[1]) : null;
}

/** Receiver of a member completion at `character` on `line` ("this.builder.ge" → builder's start). */
export function receiverAt(line: string, character: number): { name: string; character: number } | null {
  const before = line.slice(0, character);
  const m = /([\w$]+)\s*(\((?:[^()]|\([^()]*\))*\))?\s*\.\s*[\w$]*$/.exec(before);
  return m ? { name: m[1], character: m.index } : null;
}

/** Innermost type declared before `offset` (rough; used when completing without a receiver). */
export function enclosingType(text: string, offset: number): string | null {
  let found: string | null = null;
  for (const m of text.slice(0, offset).matchAll(/\b(?:class|interface|enum|record)\s+([\w$]+)/g)) found = m[1];
  return found;
}

/** Type named by a hover on an expression: field/local/parameter type or a method's return type. */
export function hoverType(hover: any): string | null {
  // Locals/parameters read "Type name - Owner.method(...)"; drop that context first.
  const code = hoverParts(hover).find(p => p.code !== undefined)?.code?.trim().replace(/\s+-\s+.*$/s, "");
  if (!code) return null;
  const paren = code.indexOf("(");
  const head = paren >= 0 ? code.slice(0, paren) : code;
  const split = lastTopLevelSpace(head);
  if (split < 0) return null;
  const type = head.slice(0, split).replace(/^(?:(?:public|protected|private|static|final|abstract|default|synchronized)\s+)*/, "");
  return simpleType(type) || null;
}

export function shapeCompletions(result: any, owner: string | null, originals: Map<string, any>, keyOf: (item: any) => string) {
  const items: any[] = Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : [];
  originals.clear();
  const shaped = items.map((original, index) => {
    const name = String(original.filterText || original.label || "").replace(/\(.*$/s, "").replace(/ [-:] .*$/, "").trim() || String(original.label);
    const params = original.labelDetails?.detail ?? (/^[^(]*(\(.*?\))/.exec(String(original.label))?.[1] || "");
    // Right side: return/field type for members, package for types.
    const typed = / : (.+)$/.exec(String(original.label))?.[1] ?? / : (.+)$/.exec(String(original.detail ?? ""))?.[1];
    const pkg = / - (.+)$/.exec(String(original.label))?.[1];
    const right = original.labelDetails?.description || typed || pkg || (original.detail && String(original.detail).length <= 48 ? original.detail : "");
    const declaring = declaringType(original);
    const own = !!owner && declaring === owner;
    const icon = KIND_ICONS[original.kind as number];
    // `label` keeps the parameters and `detail` the type so older hosts still show both; newer
    // hosts mute the label from `mutedFrom` (UTF-8 offset) and right-align the description.
    const item = { ...original, label: `${name}${params}`, detail: right || undefined, filterText: original.filterText || name,
      labelDetails: right ? { description: right } : undefined,
      data: { presentation: { bold: own, mutedFrom: utf8Length(name), ...(icon ? { icon: { text: icon[0], color: icon[1], background: icon[1] + "1f" } } : {}) }, original: index },
      // Without an explicit edit the menu inserts the label; keep inserting just the name.
      ...(!original.textEdit && !original.insertText ? { insertText: name } : {}) };
    originals.set(keyOf(item), original);
    return item;
  });
  // Members declared by the receiver's own type first, then the server's relevance order.
  const rank = (item: any) => item.data.presentation.bold ? 0 : 1;
  shaped.sort((a, b) => rank(a) - rank(b) || String(a.sortText ?? a.label).localeCompare(String(b.sortText ?? b.label)) || a.data.original - b.data.original);
  return Array.isArray(result) ? shaped : { ...result, items: shaped };
}

// ---- Hover ----------------------------------------------------------------------------------

type HoverPart = { code?: string; language?: string; markdown?: string };
export function hoverParts(hover: any): HoverPart[] {
  const contents = hover?.contents;
  const one = (c: any): HoverPart[] => typeof c === "string" ? [{ markdown: c }]
    : c && typeof c.value === "string" ? (c.kind === "markdown" || c.kind === "plaintext" ? [{ markdown: c.value }] : [{ code: c.value, language: c.language }])
    : [];
  return Array.isArray(contents) ? contents.flatMap(one) : one(contents);
}

function lastTopLevelSpace(text: string) {
  let depth = 0, at = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "<" || c === "(" || c === "[") depth++;
    else if (c === ">" || c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (c === " " && depth === 0) at = i;
  }
  return at;
}
function splitTopLevel(text: string): string[] {
  const out: string[] = []; let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "<" || c === "(" || c === "[") depth++;
    else if (c === ">" || c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out;
}

/** Package of a source file from its path (…/src/main/java/com/acme/A.java → com.acme). */
export function packageOf(uri: string): string | null {
  const path = decodeURIComponent(uri.replace(/^file:\/\//, "").replace(/#.*$/, ""));
  const m = /\/(?:src\/(?:main|test)\/java|src\/(?:main|test)\/kotlin|java|src)\/(.+)\/[^/]+\.\w+$/.exec(path);
  return m ? m[1].replace(/\//g, ".") : null;
}

/** Javadoc sections rendered by the server as "* **Parameters:**\n  * **x** text" → IDEA-style lines. */
function shapeDocs(markdown: string): string {
  const lines = markdown.split("\n"), out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const section = /^\s*\*\s+\*\*(.+?):\*\*\s*$/.exec(lines[i]);
    if (!section) { out.push(lines[i]); continue; }
    const entries: string[] = [];
    while (i + 1 < lines.length && /^\s{2,}\*\s+/.test(lines[i + 1])) {
      const entry = lines[++i].replace(/^\s+\*\s+/, "");
      const named = /^\*\*([\w$<>]+)\*\*\s*(.*)$/.exec(entry);
      entries.push(named ? `\`${named[1]}\` – ${named[2]}` : entry);
    }
    const label = section[1] === "Parameters" ? "Params" : section[1];
    if (!entries.length) continue;
    // Hard breaks (trailing backslash) keep a section's entries stacked in one paragraph.
    out.push("", [`**${label}:** ${entries[0]}`, ...entries.slice(1)].join("\\\n"));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** `declared = initializer` at a 1-based line of `text` (up to the terminating `;`), if present. */
function declarationAt(text: string, line: number, declared: string): string | null {
  const lines = text.split("\n");
  let statement = "";
  for (let i = line - 1; i >= 0 && i < lines.length && i < line + 4; i++) {
    statement += (statement ? " " : "") + lines[i].trim();
    if (statement.includes(";") || statement.endsWith("{")) break;
  }
  statement = statement.replace(/;.*$/s, "").replace(/\s*\{$/, "").replace(/\s+/g, " ").trim();
  const at = statement.indexOf(declared);
  // Only an initialized declaration (not a parameter list or a bare field) adds information.
  if (at < 0 || !statement.slice(at + declared.length).trimStart().startsWith("=") || statement.length - at > 300) return null;
  return statement.slice(at);
}

/** IDEA-style hover card: owner, formatted signature, docs with compact parameter lines, source. */
export function shapeHover(hover: any, context: { text?: string; path?: string; language?: string } = {}): any {
  const parts = hoverParts(hover);
  // Servers answer unresolved symbols with empty contents: show no card rather than an empty one.
  if (!parts.some(p => (p.code ?? p.markdown ?? "").trim())) return null;
  const codePart = parts.find(p => p.code !== undefined);
  if (!codePart?.code?.trim()) return hover;
  const code = codePart.code.trim();
  const language = codePart.language || context.language || "";
  const docs: string[] = [];
  let source: { name: string; uri: string; line: number } | null = null;
  for (const p of parts) {
    if (p.markdown === undefined || !p.markdown.trim()) continue;
    const s = /^Source:\s*\*?\[([^\]]+)\]\(([^)]+)\)\*?\s*$/.exec(p.markdown.trim());
    if (s) source = { name: s[1], uri: s[2], line: Number(/#(\d+)$/.exec(s[2])?.[1] || 0) };
    else docs.push(shapeDocs(p.markdown));
  }
  let header = "", signature = code, context2 = "";
  const paren = code.indexOf("(");
  const variable = /^(.+?)\s+-\s+(.+)$/.exec(code);
  if (paren > 0 && code.endsWith(")") && !variable) {
    // "RET Owner.name(params)" → owner header + multi-line signature.
    const head = code.slice(0, paren), split = lastTopLevelSpace(head);
    const ret = split >= 0 ? head.slice(0, split) : "";
    const qualified = head.slice(split + 1);
    const dot = qualified.lastIndexOf(".");
    const owner = dot > 0 ? qualified.slice(0, dot) : "";
    const name = qualified.slice(dot + 1);
    const params = splitTopLevel(code.slice(paren + 1, -1));
    const pkg = owner && !owner.includes(".") && source ? packageOf(source.uri) : null;
    header = owner ? (pkg ? `${pkg}.${owner}` : owner) : "";
    signature = `${ret ? ret + " " : ""}${name}(${params.length ? "\n" + params.map(p => "    " + p).join(",\n") + "\n" : ""})`;
  } else if (variable) {
    // "Type name - Owner.method(...)": show the declaration, with its initializer when local.
    signature = variable[1];
    context2 = variable[2];
    if (source && context.text && context.path && source.uri.replace(/#.*$/, "").endsWith("/" + context.path)) {
      signature = declarationAt(context.text, source.line, signature) || signature;
    }
  }
  const project = source?.name.replace(/_[0-9a-f]{6,}$/i, "");
  const blocks = [
    ...(header ? [`*${header}*`] : []),
    "```" + language + "\n" + signature + "\n```",
    ...(context2 ? [`*in ${context2}*`] : []),
    ...(docs.length ? ["---", ...docs] : []),
    ...(project ? ["---", `*${project}*`] : []),
  ];
  return { ...(hover?.range ? { range: hover.range } : {}), contents: { kind: "markdown", value: blocks.join("\n\n") } };
}
