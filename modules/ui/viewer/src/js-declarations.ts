// A token scan for declaration headers. Balance groups once, and keep literals opaque
// so braces, keywords and newlines inside them cannot create declarations.
import type { Declaration } from "./declarations";

const identifier = /^[$\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u;
const tokenPattern = /[$\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*|\d[\w.]*(?:[eE][+-]\d+)?|=>|\?\.|\+\+|--|&&|\|\||\?\?|[^\s]/uy;
const regexLiteral = /\/(?:\\[^\r\n]|\[(?:\\[^\r\n]|[^\]\\\r\n])*\]|[^/\\[\r\n])+\/[a-z]*/y;
const tagName = /[\w$][\w$.:-]*/y;
const controls = new Set(["if", "while", "for", "with", "switch", "catch"]);
const expressionPrefix = new Set(["", "(", "[", "{", "=", ":", ",", ";", "!", "~", "?", "&&", "||", "??", "+", "-", "*", "%", "&", "|", "^", "/", "<", ">", "=>", "return", "throw", "case", "yield", "await", "void", "typeof", "delete", "in", "of", "else", "do"]);
const closeFor: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

interface Token { value: string; start: number; end: number; pair?: number; statementBlock?: boolean }

function tokenize(text: string, jsx: boolean): Token[] {
  const word = new RegExp(tokenPattern);
  const regex = new RegExp(regexLiteral);
  const tag = new RegExp(tagName);
  const matches = (pattern: RegExp, at: number) => {
    pattern.lastIndex = at;
    return pattern.exec(text)?.[0];
  };
  const spaces = (at: number) => {
    while (at < text.length && /\s/.test(text[at])) at++;
    return at;
  };
  const quotedEnd = (at: number, quote: string) => {
    let i = at + 1;
    for (; i < text.length && text[i] !== "\n" && text[i] !== "\r"; i++) {
      if (text[i] === "\\") { i += text.startsWith("\r\n", i + 1) ? 2 : 1; continue; }
      if (text[i] === quote) return i + 1;
    }
    return Math.min(i, text.length);
  };
  function readTokens(at: number, interpolation: boolean, depth: number): { tokens: Token[]; end: number } {
    const tokens: Token[] = [];
    const groups: number[] = [];
    let afterControl = false, afterBlock = false;
    while ((at = spaces(at)) < text.length) {
      const c = text[at], next = text[at + 1];
      if (c === "}" && interpolation && !groups.length) return { tokens, end: at + 1 };
      if ((c === "/" && next === "/") || (at === 0 && c === "#" && next === "!")) {
        while (at < text.length && !/[\r\n]/.test(text[at])) at++;
        continue;
      }
      if (c === "/" && next === "*") {
        const end = text.indexOf("*/", at + 2);
        at = end === -1 ? text.length : end + 2;
        continue;
      }

      const previous = tokens[tokens.length - 1]?.value ?? "";
      const startsExpression = afterControl || afterBlock || expressionPrefix.has(previous);
      const statementBlock = c === "{" && (afterControl || ["else", "try", "finally", "do"].includes(previous));
      afterControl = afterBlock = false;
      let value = matches(word, at) ?? c;
      let end = at + value.length;
      if (c === "'" || c === '"') {
        end = quotedEnd(at, c);
        value = "string";
      } else if (c === "`") {
        end = templateEnd(at, depth);
        value = "literal";
      } else if (startsExpression && c === "/") {
        const literal = matches(regex, at);
        if (literal) { end = at + literal.length; value = "literal"; }
      } else if (startsExpression && jsx && c === "<" && depth < 64) {
        const element = jsxEnd(at, depth + 1);
        if (element !== undefined) { end = element; value = "literal"; }
      }

      const index = tokens.length;
      const token: Token = { value, start: at, end };
      if (Object.prototype.hasOwnProperty.call(closeFor, value)) {
        if (statementBlock) token.statementBlock = true;
        groups.push(index);
      } else if (groups.length) {
        const openIndex = groups[groups.length - 1];
        const open = tokens[openIndex];
        if (closeFor[open.value] === value) {
          groups.pop();
          open.pair = index;
          token.pair = openIndex;
          afterBlock = value === "}" && open.statementBlock === true;
          afterControl = value === ")" && ![".", "?."].includes(tokens[openIndex - 2]?.value) &&
            (controls.has(tokens[openIndex - 1]?.value) ||
            (tokens[openIndex - 1]?.value === "await" && tokens[openIndex - 2]?.value === "for"));
        }
      }
      tokens.push(token);
      at = end;
    }
    return { tokens, end: at };
  }

  function templateEnd(at: number, depth: number): number {
    if (depth >= 64) return text.length;
    for (let i = at + 1; i < text.length;) {
      if (text[i] === "`") return i + 1;
      if (text[i] === "\\") i += 2;
      else if (text.startsWith("${", i)) i = readTokens(i + 2, true, depth + 1).end;
      else i++;
    }
    return text.length;
  }

  function jsxEnd(at: number, depth: number): number | undefined {
    if (depth >= 64) return;
    const name = text[at + 1] === ">" ? "" : matches(tag, at + 1);
    if (name === undefined) return;
    let i = at + 1 + name.length;
    // Accept JSX attribute syntax, so a TS generic arrow can fall back to normal tokens.
    while ((i = spaces(i)) < text.length && text[i] !== ">") {
      if (text.startsWith("/>", i)) return i + 2;
      if (text[i] === "{") { i = readTokens(i + 1, true, depth + 1).end; continue; }
      const attr = matches(tag, i);
      if (!attr) return;
      i = spaces(i + attr.length);
      if (text[i] !== "=") continue;
      i = spaces(i + 1);
      if (text[i] === '"' || text[i] === "'") {
        const end = text.indexOf(text[i], i + 1);
        if (end === -1) return;
        i = end + 1;
      } else if (text[i] === "{") {
        i = readTokens(i + 1, true, depth + 1).end;
      } else return;
    }
    for (i++; i < text.length;) {
      if (text.startsWith("</", i)) {
        const end = spaces(i + 2 + name.length);
        return text.startsWith(name, i + 2) && text[end] === ">" ? end + 1 : undefined;
      }
      if (text[i] === "<") {
        const end = jsxEnd(i, depth + 1);
        if (end === undefined) return;
        i = end;
      } else if (text[i] === "{") {
        i = readTokens(i + 1, true, depth + 1).end;
      } else i++;
    }
    return undefined;
  }
  return readTokens(0, false, 0).tokens;
}

const declarationModifiers = new Set(["export", "default", "declare", "abstract", "async"]);
const memberModifiers = new Set(["public", "protected", "private", "static", "abstract", "declare", "override", "readonly", "accessor", "async", "get", "set"]);
const continuation = new Set([".", "?.", "(", "[", "?", ":", ",", ";", "+", "-", "*", "/", "%", "&", "|", "^", "&&", "||", "??", ">", "<", "=", "as", "satisfies", "in", "instanceof"]);

export function javascriptDeclarations(text: string, jsx = false): Declaration[] {
  if (text.length > 2_000_000) return [];
  const tokens = tokenize(text, jsx);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset: number) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const value = (i: number) => tokens[i]?.value ?? "";
  const isName = (i: number) => identifier.test(value(i));
  const group = (i: number) => {
    const pair = tokens[i]?.pair;
    return pair !== undefined && pair > i ? pair + 1 : i + 1;
  };
  const newLine = (i: number) => i > 0 && i < tokens.length && lineOf(tokens[i].start) > lineOf(tokens[i - 1].end - 1);
  const endsExpression = (i: number) => !expressionPrefix.has(value(i)) && !continuation.has(value(i));
  const statementStart = (i: number) => i === 0 || ["{", "}", ";"].includes(value(i - 1)) ||
    (newLine(i) && endsExpression(i - 1) && !continuation.has(value(i)));

  // Type parameter lists may contain nested generics or grouped constraints.
  function afterGenerics(i: number): number {
    if (value(i) !== "<") return i;
    let depth = 1;
    for (let j = i + 1; j < tokens.length; j = group(j)) {
      if (value(j) === "<") depth++;
      else if (value(j) === ">" && --depth === 0) return j + 1;
      else if (value(j) === ";" || value(j) === "}") break;
    }
    return i;
  }

  function afterType(i: number, terminator: "{" | "=>" | "="): number {
    if (value(i) !== ":") return i;
    for (let j = i + 1; j < tokens.length;) {
      const v = value(j);
      if (v === terminator) {
        // In a return type, an object type may precede the actual function body.
        if (v !== "{" || (j > i + 1 && !["|", "&", "?", ":", "extends"].includes(value(j - 1)))) return j;
      }
      if (v === ";" || v === "}" || (terminator === "=" && v === ",")) return j;
      if (v === "{") {
        if (group(j) === j + 1) return j;
      }
      const next = v === "<" ? afterGenerics(j) : j;
      j = next === j ? group(j) : next;
    }
    return tokens.length;
  }

  type Header = { kind: Declaration["kind"]; name: number; body: number; end: number };
  const block = (kind: Declaration["kind"], name: number, body: number): Header => ({ kind, name, body, end: group(body) - 1 });

  function functionHeader(i: number, fallback: number, anonymous = false): Header | undefined {
    let name = i + 1;
    if (value(name) === "*") name++;
    if (!isName(name) && fallback < 0 && !anonymous) return;
    const params = afterGenerics(isName(name) ? name + 1 : name);
    if (value(params) !== "(" || group(params) === params + 1) return;
    const body = afterType(group(params), "{");
    if (value(body) === "{") return block("method", fallback >= 0 ? fallback : isName(name) ? name : i, body);
  }

  function classHeader(i: number): Header | undefined {
    const name = isName(i + 1) && value(i + 1) !== "extends" ? i + 1 : i;
    for (let body = afterGenerics(name + 1); body < tokens.length;) {
      const v = value(body);
      if (v === "{") return block("type", name, body);
      if (["}", ";", "=", ")"].includes(v) || (body > name + 1 && statementStart(body))) return;
      const next = v === "<" ? afterGenerics(body) : body;
      body = next === body ? group(body) : next;
    }
  }

  function constHeader(i: number): Header | undefined {
    const name = i + 1;
    if (!isName(name)) return;
    const equals = afterType(name + 1, "=");
    if (value(equals) !== "=") return;
    let init = equals + 1;
    if (value(init) === "async" && !newLine(init + 1) && value(init + 1) !== "=>") init++;
    if (value(init) === "function") return functionHeader(init, name);
    const params = afterGenerics(init);
    const arrow = value(params) === "(" && group(params) > params + 1 ? afterType(group(params), "=>") : isName(params) ? params + 1 : params;
    if (value(arrow) !== "=>" || newLine(arrow)) return;
    if (value(arrow + 1) === "{") return block("method", name, arrow + 1);
    let end = arrow + 1;
    for (; end < tokens.length && ![";", "}", ")", "]", ","].includes(value(end)); end = group(end)) {
      if (end > arrow + 1 && newLine(end) && endsExpression(end - 1) && !continuation.has(value(end))) break;
    }
    return { kind: "method", name, body: -1, end: value(end) === ";" ? end : end - 1 };
  }

  function memberHeader(i: number): Header | undefined {
    let name = i;
    while (memberModifiers.has(value(name)) && !["(", "<", "?", "!", ";", "=", ":", "}"].includes(value(name + 1))) name++;
    if (value(name) === "*") name++;
    if (value(name) === "#") name++;
    const nameEnd = value(name) === "[" ? group(name) : name + 1;
    if (!isName(name) && !["string", "["].includes(value(name)) && !/^\d/.test(value(name))) return;
    const params = afterGenerics(value(nameEnd) === "?" ? nameEnd + 1 : nameEnd);
    if (value(params) !== "(" || group(params) === params + 1) return;
    const body = afterType(group(params), "{");
    if (value(body) === "{") return block("method", name, body);
    if (value(body) === ";") return { kind: "method", name, body: -1, end: body };
  }

  const declarations: Declaration[] = [];
  const blocks: boolean[] = [];
  let classBody = -1;
  for (let i = 0; i < tokens.length; i++) {
    const v = value(i);
    if (v === "{") { blocks.push(i === classBody); continue; }
    if (v === "}") { blocks.pop(); continue; }
    const inClass = blocks[blocks.length - 1];
    const startsMember = inClass && (statementStart(i) || (v === "[" && newLine(i)));
    if (v === "(" || (v === "[" && !startsMember)) { i = group(i) - 1; continue; }
    if (!startsMember && !statementStart(i)) continue;

    let header: Header | undefined;
    if (inClass) {
      header = memberHeader(i);
    } else {
      let keyword = i;
      while (declarationModifiers.has(value(keyword)) && !(value(keyword) === "async" && newLine(keyword + 1))) keyword++;
      switch (value(keyword)) {
        case "function": header = functionHeader(keyword, -1, value(i) === "export" && value(i + 1) === "default"); break;
        case "class": header = classHeader(keyword); break;
        case "const": header = constHeader(keyword); break;
      }
    }
    if (!header) { if (v === "[") i = group(i) - 1; continue; }
    const name = tokens[header.name];
    const label = name.value === "[" ? text.slice(name.start, tokens[group(header.name) - 1].end) :
      name.value === "string" ? text.slice(name.start, name.end) : name.value;
    declarations.push({ kind: header.kind, name: label, line: lineOf(name.start), start: lineOf(tokens[i].start), end: lineOf(tokens[header.end].end - 1) });
    if (header.kind === "type") classBody = header.body;
    i = header.body < 0 ? header.end : header.body - 1;
  }
  return declarations;
}
