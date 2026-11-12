// Declarations (types and methods) of a source file, for per-declaration editor annotations.
// A lexical scan: no language server needed (they are opt-in per project). Grammars without a
// scanner get no declarations.

export interface Declaration {
  kind: "type" | "method"; name: string;
  /** Zero-based line of the name, and the declaration's first/last lines (inclusive). */
  line: number; start: number; end: number;
}

/** Comments, strings, chars and text blocks replaced by spaces; offsets and newlines kept. */
function blankJava(text: string) {
  const out = text.split("");
  const blank = (from: number, to: number) => { for (let i = from; i < to && i < out.length; i++) if (out[i] !== "\n") out[i] = " "; };
  let i = 0;
  while (i < text.length) {
    const c = text[i], next = text[i + 1];
    if (c === "/" && next === "/") { const end = text.indexOf("\n", i); blank(i, end < 0 ? text.length : end); i = end < 0 ? text.length : end; }
    else if (c === "/" && next === "*") { const end = text.indexOf("*/", i + 2); const stop = end < 0 ? text.length : end + 2; blank(i, stop); i = stop; }
    else if (c === '"' && text.startsWith('"""', i)) { const end = text.indexOf('"""', i + 3); const stop = end < 0 ? text.length : end + 3; blank(i + 1, stop - 1); i = stop; }
    else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      blank(i + 1, j); i = j + 1;
    } else i++;
  }
  return out.join("");
}

const NOT_METHODS = new Set(["if", "for", "while", "switch", "catch", "synchronized", "try", "else", "do", "return", "new", "throw", "case", "assert", "finally", "yield"]);
const TYPE = /\b(class|interface|enum|record|@\s*interface)\s+([A-Za-z_$][\w$]*)/;
/** Name and parameter list at the end of a header: `name(...)` optionally `throws X, Y`. */
const METHOD = /([A-Za-z_$][\w$]*)\s*\(([^()]|\([^()]*\))*\)\s*(\[\s*\]\s*)*(throws\s+[\w$.<>,\s]+)?\s*$/;

/** Java types (class, interface, enum, record, annotation) and methods/constructors, including
 *  body-less interface and abstract methods. Lambdas, anonymous classes and control blocks are skipped. */
export function javaDeclarations(text: string): Declaration[] {
  if (text.length > 2_000_000) return [];
  const src = blankJava(text);
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset: number) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1; } return lo; };
  const out: Declaration[] = [];
  // Open blocks: whether each is a type body (methods are recognized only directly inside one).
  const stack: { type: boolean; decl: Declaration | null }[] = [];
  let headerStart = 0, parens = 0;
  const header = (end: number) => {
    const raw = src.slice(headerStart, end);
    const lead = raw.length - raw.trimStart().length;
    return { text: raw.trim(), start: headerStart + lead };
  };
  const declare = (end: number, body: boolean): Declaration | null => {
    const h = header(end);
    if (!h.text) return null;
    const inType = stack.length === 0 || stack[stack.length - 1].type;
    const type = TYPE.exec(h.text);
    if (type && body) {
      const at = h.start + type.index + type[0].length - type[2].length;
      return { kind: "type", name: type[2], line: lineOf(at), start: lineOf(h.start), end: lineOf(end) };
    }
    if (!inType || stack.length === 0 || /=|->|\bnew\s/.test(h.text)) return null;
    const method = METHOD.exec(h.text);
    if (!method || NOT_METHODS.has(method[1])) return null;
    // Something must precede the name (a return type or modifier) unless it is a constructor.
    const before = h.text.slice(0, method.index).trim();
    const owner = [...stack].reverse().find(b => b.decl?.kind === "type")?.decl?.name;
    if (!before && method[1] !== owner) return null;
    const at = h.start + method.index;
    return { kind: "method", name: method[1], line: lineOf(at), start: lineOf(h.start), end: lineOf(end) };
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "(") parens++;
    else if (c === ")") parens = Math.max(0, parens - 1);
    else if (parens > 0) continue;
    else if (c === "{") {
      const decl = declare(i, true);
      // An enum's constants and an array initializer `= {` are not methods.
      stack.push({ type: decl?.kind === "type", decl });
      headerStart = i + 1;
    } else if (c === "}") {
      const block = stack.pop();
      if (block?.decl) { block.decl.end = lineOf(i); out.push(block.decl); }
      headerStart = i + 1;
    } else if (c === ";") {
      const decl = declare(i, false);
      if (decl) out.push(decl);
      headerStart = i + 1;
    }
  }
  return out.sort((a, b) => a.line - b.line || (a.kind === b.kind ? a.start - b.start : a.kind === "type" ? -1 : 1));
}

const scanners: Record<string, (text: string) => Declaration[]> = { java: javaDeclarations };
export const declarationsFor = (grammar: string | undefined, text: string) => (grammar && scanners[grammar] ? scanners[grammar](text) : []);
export const hasDeclarations = (grammar: string | undefined) => !!grammar && grammar in scanners;
