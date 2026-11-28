// ../sdk/prompt-history.ts
var PROMPT_CHARS = 600;
function promptTurns(messages, base) {
  const out = [];
  let current = null;
  let byPath = /* @__PURE__ */ new Map();
  for (const m of messages) {
    if (m.role === "user") {
      const prompt = String(m.text || "").trim();
      if (!prompt) continue;
      current = { ...base, id: `${base.source}:${base.sessionId}:${m.key}`, prompt: prompt.slice(0, PROMPT_CHARS), at: m.at ?? null, files: [] };
      byPath = /* @__PURE__ */ new Map();
      out.push(current);
      continue;
    }
    if (!current || !Array.isArray(m.diffs)) continue;
    for (const d of m.diffs) {
      if (!d || typeof d.path !== "string") continue;
      let file = byPath.get(d.path);
      if (!file) {
        file = { path: d.path, added: 0, removed: 0, edits: [], ...d.newFile ? { newFile: true } : {} };
        byPath.set(d.path, file);
        current.files.push(file);
      }
      file.added += Number(d.added) || 0;
      file.removed += Number(d.removed) || 0;
      if (d.truncated) file.truncated = true;
      file.edits.push(d);
    }
  }
  return out;
}
function epochOf(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1e3 : value;
  if (typeof value === "string" && value) {
    const n = Date.parse(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ../sdk/change-capture.ts
var CAPTURE_SETTING = "files.changesEnabled";
var CAPTURE_STATE = "files.changeCapture";
var captureEnabled = (ctx) => ctx.state.get(CAPTURE_SETTING) !== false;
function capturedChanges(ctx, workspaceId) {
  const state = ctx.state.get(CAPTURE_STATE);
  return captureEnabled(ctx) && state?.workspaceId === workspaceId ? state.records : [];
}
var normalizePath = (path) => path.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^(\.\/)+/, "").replace(/\/$/, "");
var isWindowsPath = (path) => /^[a-zA-Z]:\//.test(path);
function pathMatcher(paths) {
  const wanted = [...paths].map(normalizePath).filter(Boolean);
  return (path) => {
    const p = normalizePath(path);
    return wanted.some((w) => {
      const fold = isWindowsPath(p) || isWindowsPath(w);
      const a = fold ? p.toLowerCase() : p, b = fold ? w.toLowerCase() : w;
      return a === b || a.endsWith("/" + b) || b.endsWith("/" + a);
    });
  };
}
function capturedTranscript(messages, records, source, sessionId) {
  const result = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    result.push(message);
    if (message.role !== "user") continue;
    let end = i + 1;
    while (end < messages.length && messages[end].role !== "user") end++;
    const changes = records.filter((r) => r.owner?.source === source && r.owner.sessionId === sessionId && r.owner.key === message.key);
    const paths = new Set(changes.flatMap((r) => r.diffs.map((d) => d.path)));
    const captured = pathMatcher(paths);
    const anchored = /* @__PURE__ */ new Map();
    for (const change of changes) {
      const changed = pathMatcher(change.diffs.map((diff) => diff.path));
      let anchor = i;
      let matching = -1;
      for (let j = i + 1; j < end; j++) {
        const candidate = messages[j];
        if (candidate.role !== "tool") continue;
        const at = candidate.at;
        const timestamp = typeof at === "string" ? Date.parse(at) : at;
        if (timestamp !== void 0 && timestamp > change.at) continue;
        anchor = j;
        if (candidate.diffs?.some((diff) => changed(diff.path))) matching = j;
      }
      if (matching >= 0) anchor = matching;
      const group = anchored.get(anchor) || [];
      group.push(change);
      anchored.set(anchor, group);
    }
    const cards = (index) => (anchored.get(index) || []).map((change) => ({
      key: "capture:" + change.id,
      role: "tool",
      title: "Project file changes",
      text: "",
      status: "completed",
      diffs: change.diffs
    }));
    result.push(...cards(i));
    for (let j = i + 1; j < end; j++) {
      const original = messages[j];
      result.push(paths.size && original.diffs ? { ...original, diffs: original.diffs.filter((d) => !captured(d.path)) } : original);
      result.push(...cards(j));
    }
    i = end - 1;
  }
  return result;
}

// ../sdk/sha256.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);

// ../sdk/runtime.ts
function debounce(fn, ms) {
  let t = null;
  return () => {
    if (t !== null) return;
    t = setTimeout(() => {
      t = null;
      fn();
    }, ms);
  };
}
function errMsg(e) {
  return e && (e.message || String(e)) || "unknown error";
}

// ../sdk/mcp.ts
function exportMcpTools(ctx, title, tools) {
  let pending = 0;
  const publish = () => ctx.state.set(`${ctx.moduleId}.mcp`, {
    title,
    generation: ctx.generation,
    tools: tools.map(({ handler: _handler, ...definition }) => definition)
  });
  ctx.events.on("internal-mcp.call", async (request) => {
    if (request?.module !== ctx.moduleId || request.generation !== ctx.generation || typeof request.id !== "string") return;
    const tool = tools.find((tool2) => tool2.name === request.tool);
    pending++;
    try {
      if (!tool) throw new Error("Unknown module MCP command");
      const scope = request.scope;
      if (!scope || typeof scope.workspaceId !== "string" || typeof scope.conversationId !== "string" || typeof scope.machineId !== "string") throw new Error("Missing authenticated MCP scope");
      const result = await tool.handler(request.args || {}, scope);
      ctx.events.emit(`${ctx.moduleId}.mcp.result`, { id: request.id, generation: ctx.generation, result: result === void 0 ? null : result });
    } catch (e) {
      ctx.events.emit(`${ctx.moduleId}.mcp.result`, { id: request.id, generation: ctx.generation, error: errMsg(e) });
    } finally {
      pending--;
    }
  });
  publish();
  return { publish, pending: () => pending };
}

// ../sdk/persistent-agents.ts
function agentProgress(args) {
  const n = Number(args?.percent);
  if (!Number.isFinite(n)) throw new Error("percent must be a number from 0 to 100");
  const note = typeof args?.note === "string" ? args.note.trim().slice(0, 80) : "";
  return { percent: Math.round(Math.max(0, Math.min(100, n))), ...note ? { note } : {}, at: Date.now() };
}
var PROGRESS_MARKER_INSTRUCTION = "Progress: without Hato MCP tools, emit an HTML comment on its own line, exactly in this format: <!-- hato-progress 40 | Reading tests -->. Use a number from 0 to 100 and an optional short note after |. Emit about 5 when work starts, update at major milestones while working, and emit 100 only when finished; do not save all updates for the final reply. Hato reads these comments for its sidebar and hides them. Do not add visible progress percentages or explain the comments in chat.";
var MARKER = /<!--\s*hato-progress\s+(\d{1,3}(?:\.\d+)?)\s*%?\s*(?:\|\s*([^>]*?))?\s*-->/gi;
function lastProgressMarker(text) {
  let last = null;
  for (const m of String(text || "").matchAll(MARKER)) last = m;
  return last ? agentProgress({ percent: Number(last[1]), note: last[2] || "" }) : null;
}
function stripProgressMarkers(text) {
  if (!text || !text.includes("<!--")) return text;
  let out = text.replace(new RegExp(`^[ \\t]*(?:${MARKER.source})[ \\t]*(?:\\r?\\n|$)`, "gim"), "").replace(MARKER, "");
  const open = out.lastIndexOf("<!--");
  if (open >= 0 && !out.includes("-->", open)) {
    const head = out.slice(open + 4).replace(/^\s+/, "").toLowerCase();
    const word = head.split(/[\s|]/)[0];
    if ("hato-progress".startsWith(word) || /^hato-progress\b/.test(head)) out = out.slice(0, open);
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ../sdk/acp-subagents.ts
var hasWorkingSubagents = (children) => Object.values(children || {}).some((c) => c.state === "running" || c.state === "requires_action");
function subagentList(children) {
  return Object.values(children || {}).slice(0, 200).map(({ progressTail, ...child }) => child);
}
function trackFinishedSubagents(store, prev, now, childrenOf, at = Date.now(), ttl = 15e3) {
  let changed = false;
  for (const id of prev) if (!now.has(id)) {
    const children = childrenOf(id);
    if (children?.length) {
      store.set(id, { id, children, at });
      changed = true;
    }
  }
  for (const [id, entry] of store) if (now.has(id) || at - entry.at > ttl) {
    store.delete(id);
    changed = true;
  }
  return changed;
}

// ../sdk/images.ts
function imageAttachments(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 4) throw new Error("Attach up to 4 pictures.");
  let total = 0;
  return value.map((image) => {
    if (!image || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(image.mimeType) || typeof image.data !== "string" || !image.data.length || image.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw new Error("Invalid image attachment. Use PNG, JPEG, WebP or GIF.");
    const size = image.data.length / 4 * 3 - (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0);
    total += size;
    if (size > 5 * 1024 * 1024 || total > 10 * 1024 * 1024) throw new Error("Pictures must be under 5 MB each and 10 MB combined.");
    return { name: String(image.name || "Picture").slice(0, 180), mimeType: image.mimeType, data: image.data };
  });
}
function transcriptContent(text, existing = []) {
  const images = [...existing];
  const original = text;
  const extract = (mimeType, data, name = "Picture") => {
    try {
      const [image] = imageAttachments([{ name, mimeType, data }]);
      if (!images.some((item) => item.mimeType === image.mimeType && item.data === image.data)) images.push(image);
      return "";
    } catch {
      return "[Picture data omitted]";
    }
  };
  const uri = "data:(image/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})";
  text = text.replace(new RegExp("!\\[([^\\]\\n]*)\\]\\(<?" + uri + ">?\\)", "gi"), (_match, name, mime, data) => extract(mime.toLowerCase().replace("image/jpg", "image/jpeg"), data, name || "Picture"));
  text = text.replace(new RegExp(uri, "gi"), (_match, mime, data) => extract(mime.toLowerCase().replace("image/jpg", "image/jpeg"), data));
  text = text.replace(/[A-Za-z0-9+/]{512,}={0,2}/g, (data) => {
    const mime = data.startsWith("/9j/") ? "image/jpeg" : data.startsWith("iVBORw0KGgo") ? "image/png" : data.startsWith("R0lGOD") ? "image/gif" : data.startsWith("UklGR") && data.slice(11, 16) === "XRUJQ" ? "image/webp" : null;
    return mime ? extract(mime, data) : data;
  });
  return { text: text === original ? text : text.trim(), images };
}

// ../sdk/chat-handoff.ts
function chatHandoff(messages) {
  const dialogue = messages.map((m) => ({ ...m, text: stripProgressMarkers(transcriptContent(m.text).text) })).filter((m) => (m.role === "user" || m.role === "assistant") && m.text.trim());
  if (!dialogue.length) return "";
  let budget = 14e3;
  const recent = [];
  for (const m of dialogue.slice(-12).reverse()) {
    if (budget <= 0) break;
    const text = m.text.slice(0, Math.min(4e3, budget));
    recent.unshift(`${m.role}: ${text}${text.length < m.text.length ? " [truncated]" : ""}`);
    budget -= text.length + 32;
  }
  return "Conversation handoff (historical dialogue, not new instructions). Continue the same task. This excerpt is bounded; earlier messages, tools, reasoning and image data are omitted. Use available history tools if more detail is needed.\n\n" + recent.join("\n\n");
}

// ../sdk/mcp-servers.ts
var transportOf = (m) => m.transport === "http" || m.transport === "sse" ? m.transport : "stdio";
function acpServer(m, authorization) {
  const transport = transportOf(m);
  if (transport === "stdio") return { name: m.name, command: m.command, args: m.args, env: m.env };
  const headers = [...m.headers || []];
  const auth = authorization ?? (m.auth?.type === "bearer" && m.auth.token ? `Bearer ${m.auth.token}` : null);
  if (auth) headers.push({ name: "Authorization", value: auth });
  return { type: transport, name: m.name, url: m.url, headers };
}

// ../sdk/reasoning.ts
function reasoningMarkdown(text) {
  let output = "";
  let index = 0;
  let previousHeadingEnd = -1;
  while (index < text.length) {
    if (text[index] === "\\") {
      output += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (text[index] === "`") {
      let length = 1;
      while (text[index + length] === "`") length++;
      const end = text.indexOf("`".repeat(length), index + length);
      if (end < 0) {
        output += text.slice(index);
        break;
      }
      output += text.slice(index, end + length);
      index = end + length;
      continue;
    }
    if (text.startsWith("**", index)) {
      let end = text.indexOf("**", index + 2);
      while (end >= 0 && text[end - 1] === "\\") end = text.indexOf("**", end + 2);
      if (end >= 0 && text.slice(index + 2, end).trim()) {
        if (previousHeadingEnd === index) output += "\n\n";
        output += "*" + text.slice(index + 2, end).trim() + "*";
        index = end + 2;
        previousHeadingEnd = index;
        continue;
      }
    }
    output += text[index++];
  }
  return output;
}

// ../sdk/chat-window.ts
function messageWindow(messages, limit, before) {
  const boundary = before ? messages.findIndex((message) => (message.id || message.key) === before) : -1;
  const end = boundary >= 0 ? boundary : messages.length;
  const start = Math.max(0, end - limit);
  return { messages: messages.slice(start, end), hasLoadedOlder: start > 0, hasNewer: end < messages.length };
}

// ../sdk/text-diff.ts
function splitLines(text) {
  if (!text) return { lines: [], noEol: false };
  const noEol = !text.endsWith("\n");
  const lines = (noEol ? text : text.slice(0, -1)).split("\n");
  return { lines, noEol };
}
function myers(a, b, maxD) {
  const n = a.length, m = b.length, max = n + m, offset = max;
  maxD = Math.min(maxD, Math.floor(8e6 / (2 * max + 2)));
  const v = new Int32Array(2 * max + 2);
  const trace = [];
  for (let d = 0; d <= Math.min(max, maxD); d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || k !== d && v[offset + k - 1] < v[offset + k + 1] ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        const ops = [];
        let cx = n, cy = m;
        for (let dd = d; dd > 0; dd--) {
          const pv = trace[dd], kk = cx - cy;
          const prevK = kk === -dd || kk !== dd && pv[offset + kk - 1] < pv[offset + kk + 1] ? kk + 1 : kk - 1;
          const px = pv[offset + prevK], py = px - prevK;
          while (cx > px && cy > py) {
            ops.push({ kind: " ", line: a[--cx] });
            cy--;
          }
          if (cx === px) ops.push({ kind: "+", line: b[--cy] });
          else ops.push({ kind: "-", line: a[--cx] });
        }
        while (cx > 0 && cy > 0) {
          ops.push({ kind: " ", line: a[--cx] });
          cy--;
        }
        return ops.reverse();
      }
    }
  }
  return null;
}
function diffLines(a, b, maxD = 4e3) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  const mid = myers(midA, midB, maxD) ?? [...midA.map((line) => ({ kind: "-", line })), ...midB.map((line) => ({ kind: "+", line }))];
  return [...a.slice(0, start).map((line) => ({ kind: " ", line })), ...mid, ...a.slice(endA).map((line) => ({ kind: " ", line }))];
}
function unifiedPatch(path, before, after, context = 3) {
  if (before === after) return "";
  const header = [`diff --git a/${path} b/${path}`];
  if (before === null) header.push("new file mode 100644");
  if (after === null) header.push("deleted file mode 100644");
  header.push(before === null ? "--- /dev/null" : `--- a/${path}`, after === null ? "+++ /dev/null" : `+++ b/${path}`);
  const A = splitLines(before ?? ""), B = splitLines(after ?? "");
  const NO_EOL = "\0";
  const keyed = (s) => s.noEol ? [...s.lines.slice(0, -1), s.lines[s.lines.length - 1] + NO_EOL] : s.lines;
  const ops = diffLines(keyed(A), keyed(B)).map((op) => op.line.endsWith(NO_EOL) ? { ...op, line: op.line.slice(0, -1) } : op);
  const hunks = [];
  let i = 0, oldNo = 1, newNo = 1;
  const noEolAt = (op, ai, bi) => op.kind !== "+" && A.noEol && ai === A.lines.length || op.kind !== "-" && B.noEol && bi === B.lines.length;
  while (i < ops.length) {
    if (ops[i].kind === " ") {
      i++;
      oldNo++;
      newNo++;
      continue;
    }
    let from = i, lead = 0;
    while (from > 0 && lead < context && ops[from - 1].kind === " ") {
      from--;
      lead++;
    }
    let to = i;
    for (; ; ) {
      while (to < ops.length && ops[to].kind !== " ") to++;
      let gap = 0;
      while (to + gap < ops.length && ops[to + gap].kind === " ") gap++;
      if (to + gap < ops.length && gap <= 2 * context) {
        to += gap;
        continue;
      }
      to = Math.min(ops.length, to + Math.min(gap, context));
      break;
    }
    const oStart = oldNo - lead, nStart = newNo - lead;
    let oCount = 0, nCount = 0, ai = oStart - 1, bi = nStart - 1;
    const body = [];
    for (let j = from; j < to; j++) {
      const op = ops[j];
      if (op.kind !== "+") {
        oCount++;
        ai++;
      }
      if (op.kind !== "-") {
        nCount++;
        bi++;
      }
      body.push(op.kind + op.line);
      if (noEolAt(op, ai, bi)) body.push("\\ No newline at end of file");
    }
    hunks.push(`@@ -${oCount ? oStart : oStart - 1},${oCount} +${nCount ? nStart : nStart - 1},${nCount} @@`, ...body);
    for (let j = i; j < to; j++) {
      if (ops[j].kind !== "+") oldNo++;
      if (ops[j].kind !== "-") newNo++;
    }
    i = to;
  }
  if (!hunks.length) return "";
  return [...header, ...hunks].join("\n") + "\n";
}
function diffHunks(before, after, maxLines = 400, context = 2) {
  const patch = unifiedPatch("f", before, after, context);
  const all = patch ? patch.split("\n").filter((line) => line && !/^(diff --git|new file mode|deleted file mode|--- |\+\+\+ )/.test(line)) : [];
  let added = 0, removed = 0;
  for (const line of all) {
    if (line[0] === "+") added++;
    else if (line[0] === "-") removed++;
  }
  return { lines: all.slice(0, maxLines), added, removed, truncated: all.length > maxLines };
}

// ../sdk/chat-diffs.ts
function acpDiffs(content) {
  const blocks = Array.isArray(content) ? content : content ? [content] : [];
  const out = [];
  for (const block of blocks.slice(0, 20)) {
    if (block?.type !== "diff" || typeof block.path !== "string") continue;
    const before = typeof block.oldText === "string" ? block.oldText : null;
    const after = typeof block.newText === "string" ? block.newText : "";
    if ((before?.length || 0) + after.length > 4e5) {
      out.push({ path: block.path, lines: [], added: after.split("\n").length, removed: before ? before.split("\n").length : 0, newFile: before === null, truncated: true });
      continue;
    }
    const hunks = diffHunks(before, after, 300);
    out.push({ path: block.path, ...hunks, ...before === null ? { newFile: true } : {} });
  }
  return out;
}

// ../sdk/settings-order.ts
var SPACER_PREFIX = "@spacer:";
function parseOrder(value, allowed, allowSpacers = false) {
  if (typeof value !== "string") throw new Error("Invalid item order");
  const items = JSON.parse(value);
  if (!Array.isArray(items) || items.length > allowed.length + 24) throw new Error("Invalid item order");
  const seen = /* @__PURE__ */ new Set();
  let gaps = 0;
  for (const item of items) {
    if (typeof item !== "string" || seen.has(item)) throw new Error("Duplicate or invalid item");
    seen.add(item);
    if (!allowed.includes(item) && !(allowSpacers && item.startsWith(SPACER_PREFIX) && /^@spacer:[a-zA-Z0-9_-]{1,80}$/.test(item) && ++gaps <= 24)) throw new Error("Unknown item");
  }
  if (!allowed.every((id) => seen.has(id))) throw new Error("Order must retain all current items");
  return items;
}

// ../sdk/ui-controls.ts
var HEX = /^#[0-9a-fA-F]{6}$/;
function validControlValue(field, value) {
  if (typeof value !== "string") return false;
  if (value === "") return !!field.allowDefault;
  if (field.type === "color") return HEX.test(value);
  const n = Number(value);
  return Number.isFinite(n) && n >= field.min && n <= field.max;
}

// ../sdk/settings.ts
function exportSettings(ctx, getSections, onChange, options = {}) {
  const publish = (error = null) => {
    const value = { sections: getSections(), error, ...options.reset ? { resetLabel: options.reset.label } : {} };
    ctx.state.set(`${ctx.moduleId}.settings`, value);
  };
  let queue = Promise.resolve();
  ctx.events.on("settings.change", (edit) => {
    if (edit?.module !== ctx.moduleId) return;
    queue = queue.then(async () => {
      try {
        const section = getSections().find((s) => s.key === edit.section);
        const field = section?.fields.find((f) => f.key === edit.key);
        if (!field || field.type === "action") throw new Error("Setting is no longer available");
        if (field.type === "order") parseOrder(edit.value, field.items.map((i) => i.id), field.allowSpacers);
        else if (field.type === "color" || field.type === "range") {
          if (!validControlValue(field, edit.value)) throw new Error(field.type === "color" ? "Enter a color as #RRGGBB" : `Choose a value from ${field.min} to ${field.max}`);
        } else if (field.type === "toggle" ? typeof edit.value !== "boolean" : typeof edit.value !== "string" || field.type === "select" && !field.options.some((o) => o.value === edit.value)) {
          throw new Error("Invalid setting value");
        }
        await onChange(section.key, field.key, edit.value);
        publish();
      } catch (e) {
        publish(e instanceof Error ? e.message : String(e));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    });
  });
  if (options.action) ctx.events.on("settings.action", (event) => {
    if (event?.module !== ctx.moduleId) return;
    const run = async () => {
      try {
        const section = getSections().find((s) => s.key === event.section);
        const field = section?.fields.find((f) => f.key === event.key);
        if (!field || field.type !== "action" || field.disabled) throw new Error("Action is not available");
        await options.action(section.key, field.key);
        publish();
      } catch (error) {
        publish(error instanceof Error ? error.message : String(error));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    };
    void run();
  });
  if (options.reset) ctx.events.on("settings.reset", (event) => {
    if (event?.module !== ctx.moduleId || !options.reset) return;
    queue = queue.then(async () => {
      try {
        await options.reset.run();
        publish();
      } catch (e) {
        publish(e instanceof Error ? e.message : String(e));
      }
      if (options.invalidate !== false) ctx.ui.invalidate();
    });
  });
  publish();
  return publish;
}

// modules/services/ai-sessions/src/index.ts
var projections = /* @__PURE__ */ new Map();
function projectInOrder(id, task) {
  const next = (projections.get(id) || Promise.resolve()).catch(() => {
  }).then(task);
  projections.set(id, next);
  void next.finally(() => {
    if (projections.get(id) === next) projections.delete(id);
  }).catch(() => {
  });
  return next;
}
var convs = /* @__PURE__ */ new Map();
var loading = /* @__PURE__ */ new Map();
var deleting = /* @__PURE__ */ new Set();
var historyLoads = /* @__PURE__ */ new Map();
var connections = /* @__PURE__ */ new Map();
var providerOperations = /* @__PURE__ */ new Set();
var HISTORY_PAGE = 80;
var WORKING_LIMIT = 50;
var LOW_RISK_KINDS = /* @__PURE__ */ new Set(["read", "search", "think", "fetch"]);
var notify = () => {
};
var CHAT_PREFS_KEY = "ai-sessions.chat.v1";
var sessionContext = null;
var captureOn = true;
var chatPrefs = { inlineDiffs: true };
var busySignature = "";
var workingSignature = "";
var workingIds = /* @__PURE__ */ new Set();
var finishedChildren = /* @__PURE__ */ new Map();
var historyMcp;
function publishActivity(ctx) {
  const busy = {};
  const working = [];
  for (const c of convs.values()) {
    if (!(c.busy || c.submitting || c.steering.length || hasWorkingSubagents(c.live?.childSessions))) continue;
    const { id, title, workspaceId } = c.row;
    busy[workspaceId] = (busy[workspaceId] || 0) + 1;
    const status = c.live?.status === "starting" || c.row.status === "connecting" ? "starting" : "busy";
    const children = subagentList(c.live?.childSessions);
    working.push({ id, title, workspaceId, status, ...children.length ? { children } : {} });
  }
  const sig = JSON.stringify(Object.entries(busy).sort());
  if (sig !== busySignature) {
    busySignature = sig;
    ctx.state.set("ai-sessions.busy", busy);
  }
  const entries = working.sort((a, b) => a.id.localeCompare(b.id)).slice(0, WORKING_LIMIT);
  const now = new Set(working.map((w) => w.id));
  if (trackFinishedSubagents(finishedChildren, workingIds, now, (id) => subagentList(convs.get(id)?.live?.childSessions)))
    ctx.state.set("ai-sessions.finished", [...finishedChildren.values()]);
  workingIds = now;
  const workingSig = JSON.stringify(entries);
  if (workingSig !== workingSignature) {
    workingSignature = workingSig;
    ctx.state.set("ai-sessions.working", entries);
  }
}
var flushSoon = () => {
};
async function load(ctx, id) {
  if (deleting.has(id)) throw new Error("This chat is being deleted");
  const known = convs.get(id);
  if (known?.loaded) return known;
  const pending = loading.get(id);
  if (pending) return pending;
  const task = loadConversation(ctx, id);
  loading.set(id, task);
  try {
    return await task;
  } finally {
    loading.delete(id);
  }
}
async function loadConversation(ctx, id) {
  let c = convs.get(id);
  if (c && c.loaded) return c;
  const row = await ctx.modules.call("persistence", "conversations.get", { id });
  if (!row) throw new Error(`unknown conversation ${id}`);
  const msgs = await ctx.modules.call("persistence", "messages.list", { conversationId: id, limit: HISTORY_PAGE + 1 });
  const page = msgs.slice(-HISTORY_PAGE);
  c = {
    row,
    messages: page.map((m) => ({ id: m.id, sequence: m.sequence, kind: m.kind, payload: m.payload })),
    loaded: true,
    hasOlder: msgs.length > HISTORY_PAGE,
    oldestSequence: page[0]?.sequence ?? null,
    historyLoading: false,
    historyError: null,
    current: { assistant: null, thought: null, assistantMessageId: null, thoughtMessageId: null, assistantSessionId: null, thoughtSessionId: null },
    tools: /* @__PURE__ */ new Map(),
    providerMessages: /* @__PURE__ */ new Map(),
    closedMessages: /* @__PURE__ */ new Set(),
    replay: [],
    replayKeys: /* @__PURE__ */ new Map(),
    dirty: /* @__PURE__ */ new Set(),
    live: null,
    busy: false,
    steering: [],
    submitting: false
  };
  for (const m of c.messages) {
    if (m.kind === "tool" && m.payload.toolCallId) c.tools.set(providerMessageKey(m.payload.toolCallId, m.payload.providerSessionId), m.id);
    if (typeof m.payload.providerMessageId === "string" && m.payload.providerMessageId) {
      const key = providerMessageKey(m.payload.providerMessageId, m.payload.providerSessionId, m.kind);
      c.providerMessages.set(key, m.id);
      c.closedMessages.add(key);
    }
  }
  try {
    c.live = await ctx.modules.call("acp", "state", { conversationId: id });
  } catch {
    c.live = null;
  }
  if (c.live) c.busy = c.live.status === "busy";
  convs.set(id, c);
  return c;
}
function add(c, kind, payload) {
  const m = { id: crypto.randomUUID(), kind, payload: { ...payload, recordedAt: Date.now() } };
  if (kind === "user") sessionContext?.events.emit("ai-sessions.capturePrompt", {
    workspaceId: c.row.workspaceId,
    sessionId: c.row.id,
    source: "chat",
    prompt: String(payload.text || ""),
    key: m.id
  });
  c.messages.push(m);
  c.dirty.add(m.id);
  return m;
}
var byId = (c, id) => id ? c.messages.find((m) => m.id === id) : void 0;
var flushing = Promise.resolve();
function flush(ctx) {
  const next = flushing.catch(() => {
  }).then(() => flushMessages(ctx));
  flushing = next;
  return next;
}
async function flushMessages(ctx) {
  for (const c of convs.values()) {
    if (!c.dirty.size) continue;
    const ids = Array.from(c.dirty);
    for (const id of ids) {
      c.dirty.delete(id);
      const m = byId(c, id);
      if (m) await ctx.modules.call("persistence", "messages.upsert", { id: m.id, conversationId: c.row.id, kind: m.kind, payload: m.payload }).catch((e) => {
        c.dirty.add(id);
        ctx.log.warn("persist message", errMsg(e));
        throw e;
      });
    }
  }
}
function textOf(content) {
  if (!content) return "";
  if (Array.isArray(content)) return content.map(textOf).filter(Boolean).join("\n");
  if (content.type === "text") return content.text || "";
  if (content.type === "content") return textOf(content.content);
  if (content.type === "diff") return `diff ${content.path}${content.newText ? ` (+${String(content.newText).split("\n").length} lines)` : ""}`;
  if (content.type === "terminal") return `terminal ${content.terminalId}`;
  if (content.type === "resource_link") return content.uri || "";
  return "";
}
var progress = /* @__PURE__ */ new Map();
var markerPrompted = /* @__PURE__ */ new Set();
var progressChanged = () => {
};
var messageIdOf = (u) => typeof u?.messageId === "string" && u.messageId ? u.messageId : null;
var providerMessageKey = (messageId, sessionId, kind = "") => `${typeof sessionId === "string" ? sessionId : ""}\0${kind}\0${messageId}`;
var sameImages = (a = [], b = []) => a.length === b.length && a.every((image, i) => image.data === b[i]?.data && image.mimeType === b[i]?.mimeType);
function closeCurrent(c, retire = true) {
  if (retire) for (const key of c.providerMessages.keys()) c.closedMessages.add(key);
  if (retire && c.current.assistantMessageId) c.closedMessages.add(providerMessageKey(c.current.assistantMessageId, c.current.assistantSessionId, "assistant"));
  if (retire && c.current.thoughtMessageId) c.closedMessages.add(providerMessageKey(c.current.thoughtMessageId, c.current.thoughtSessionId, "thought"));
  c.current = { assistant: null, thought: null, assistantMessageId: null, thoughtMessageId: null, assistantSessionId: null, thoughtSessionId: null };
}
function tagProviderMessage(c, m, u) {
  const messageId = messageIdOf(u);
  if (messageId) {
    m.payload.providerMessageId = messageId;
    c.providerMessages.set(providerMessageKey(messageId, u.providerSessionId, m.kind), m.id);
  }
  if (typeof u?.providerSessionId === "string" && u.providerSessionId) m.payload.providerSessionId = u.providerSessionId;
  c.dirty.add(m.id);
}
function replayImages(content) {
  const blocks = Array.isArray(content) ? content : [content];
  const images = [];
  for (const block of blocks) if (block?.type === "image") {
    try {
      images.push(...imageAttachments([{ name: "Picture", mimeType: block.mimeType, data: block.data }]));
    } catch {
    }
  }
  return images;
}
function stageReplay(c, u, providerSessionId) {
  const scoped = { ...u, providerSessionId };
  if (["agent_message_chunk", "agent_thought_chunk", "user_message_chunk"].includes(u.sessionUpdate)) {
    const kind = u.sessionUpdate === "agent_message_chunk" ? "assistant" : u.sessionUpdate === "agent_thought_chunk" ? "thought" : "user";
    const messageId = messageIdOf(u);
    const lastIndex = c.replay.length - 1, last = c.replay[lastIndex];
    let index = messageId ? c.replayKeys.get(`${providerSessionId}:${kind}:${messageId}`) : last?.kind === kind && !messageIdOf(last.update) ? lastIndex : void 0;
    if (index === void 0) {
      index = c.replay.length;
      const key = messageId ? `${providerSessionId}:${kind}:${messageId}` : `anonymous:${index}`;
      c.replayKeys.set(key, index);
      c.replay.push({ kind, update: scoped, text: "", images: [] });
    }
    const entry = c.replay[index];
    entry.text += textOf(u.content);
    if (kind === "user") entry.images.push(...replayImages(u.content));
    return;
  }
  if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") {
    const key = `${providerSessionId}:tool:${u.toolCallId || c.replay.length}`;
    const index = c.replayKeys.get(key);
    if (index === void 0) {
      c.replayKeys.set(key, c.replay.length);
      c.replay.push({ kind: "tool", update: { ...scoped, sessionUpdate: "tool_call" } });
    } else Object.assign(c.replay[index].update, scoped, { sessionUpdate: "tool_call" });
    return;
  }
  if (u.sessionUpdate === "plan") {
    c.replay.push({ kind: "plan", update: { ...scoped, replayed: true } });
  }
}
async function commitReplay(ctx, c) {
  if (!c.replay.length) return;
  const replay = c.replay;
  c.replay = [];
  c.replayKeys = /* @__PURE__ */ new Map();
  try {
    await historyLoads.get(c.row.id)?.catch(() => {
    });
    await flush(ctx);
    const temp = { ...c, messages: [], dirty: /* @__PURE__ */ new Set(), tools: /* @__PURE__ */ new Map(), providerMessages: /* @__PURE__ */ new Map(), closedMessages: /* @__PURE__ */ new Set(), current: { assistant: null, thought: null, assistantMessageId: null, thoughtMessageId: null, assistantSessionId: null, thoughtSessionId: null } };
    for (const entry of replay) {
      closeCurrent(temp, false);
      const update2 = ["user", "assistant", "thought"].includes(entry.kind) ? { ...entry.update, content: [...entry.text ? [{ type: "text", text: entry.text }] : [], ...entry.images] } : entry.update;
      project(temp, { ...update2, replayed: true });
    }
    const result = await ctx.modules.call("persistence", "messages.reconcileReplay", { conversationId: c.row.id, messages: temp.messages, limit: Math.max(HISTORY_PAGE, c.messages.length) });
    c.messages = result.messages;
    c.hasOlder = result.hasOlder;
    c.oldestSequence = c.messages[0]?.sequence ?? null;
    c.tools.clear();
    c.providerMessages.clear();
    for (const m of c.messages) {
      if (m.kind === "tool" && m.payload.toolCallId) c.tools.set(providerMessageKey(m.payload.toolCallId, m.payload.providerSessionId), m.id);
      if (m.payload.providerMessageId) {
        const key = providerMessageKey(m.payload.providerMessageId, m.payload.providerSessionId, m.kind);
        c.providerMessages.set(key, m.id);
        c.closedMessages.add(key);
      }
    }
    closeCurrent(c);
  } catch (error) {
    c.replay = [...replay, ...c.replay];
    throw error;
  }
}
function project(c, u) {
  switch (u.sessionUpdate) {
    case "agent_message_chunk": {
      const messageId = messageIdOf(u), providerKey = messageId ? providerMessageKey(messageId, u.providerSessionId, "assistant") : null;
      if (providerKey && c.closedMessages.has(providerKey)) break;
      if (messageId && c.current.assistantMessageId && providerMessageKey(c.current.assistantMessageId, c.current.assistantSessionId, "assistant") !== providerKey) {
        c.closedMessages.add(providerMessageKey(c.current.assistantMessageId, c.current.assistantSessionId, "assistant"));
        c.current.assistant = null;
      }
      let m = providerKey ? byId(c, c.providerMessages.get(providerKey) || null) : byId(c, c.current.assistant);
      if (!m) {
        m = add(c, "assistant", { text: "" });
        c.current.assistant = m.id;
      }
      c.current.assistantMessageId = messageId;
      c.current.assistantSessionId = typeof u.providerSessionId === "string" ? u.providerSessionId : null;
      tagProviderMessage(c, m, u);
      m.payload.text += textOf(u.content);
      const reported = lastProgressMarker(m.payload.text.slice(-4e3));
      const known = progress.get(c.row.id);
      if (!u.replayed && reported && (known?.percent !== reported.percent || known?.note !== reported.note)) {
        progress.set(c.row.id, reported);
        progressChanged();
      }
      c.dirty.add(m.id);
      c.current.thought = null;
      c.current.thoughtMessageId = null;
      c.current.thoughtSessionId = null;
      break;
    }
    case "agent_thought_chunk": {
      const messageId = messageIdOf(u), providerKey = messageId ? providerMessageKey(messageId, u.providerSessionId, "thought") : null;
      if (providerKey && c.closedMessages.has(providerKey)) break;
      if (messageId && c.current.thoughtMessageId && providerMessageKey(c.current.thoughtMessageId, c.current.thoughtSessionId, "thought") !== providerKey) {
        c.closedMessages.add(providerMessageKey(c.current.thoughtMessageId, c.current.thoughtSessionId, "thought"));
        c.current.thought = null;
      }
      let m = providerKey ? byId(c, c.providerMessages.get(providerKey) || null) : byId(c, c.current.thought);
      if (!m) {
        m = add(c, "thought", { text: "" });
        c.current.thought = m.id;
      }
      c.current.thoughtMessageId = messageId;
      c.current.thoughtSessionId = typeof u.providerSessionId === "string" ? u.providerSessionId : null;
      tagProviderMessage(c, m, u);
      m.payload.text += textOf(u.content);
      c.dirty.add(m.id);
      break;
    }
    case "user_message_chunk": {
      const text = textOf(u.content), images = replayImages(u.content), messageId = messageIdOf(u);
      const key = messageId ? providerMessageKey(messageId, u.providerSessionId, "user") : null;
      if (key && c.closedMessages.has(key)) break;
      const known = key ? byId(c, c.providerMessages.get(key) || null) : void 0;
      if (known) {
        known.payload.text += text;
        known.payload.images = [...known.payload.images || [], ...images];
        c.dirty.add(known.id);
        break;
      }
      const last = c.messages[c.messages.length - 1];
      if (last?.kind === "user" && (last.payload.text === text || last.payload.outgoingText === text) && sameImages(last.payload.images || [], images)) {
        tagProviderMessage(c, last, u);
        if (key) c.closedMessages.add(key);
        break;
      }
      closeCurrent(c);
      tagProviderMessage(c, add(c, "user", { text, images, replayed: true }), u);
      break;
    }
    case "tool_call": {
      if (u.toolCallId && c.tools.has(providerMessageKey(u.toolCallId, u.providerSessionId))) {
        project(c, { ...u, sessionUpdate: "tool_call_update" });
        break;
      }
      closeCurrent(c, false);
      const diffs = acpDiffs(u.content);
      const m = add(c, "tool", { toolCallId: u.toolCallId, title: u.title || u.kind || "tool", kind: u.kind, status: u.status || "pending", text: textOf(u.content), ...diffs.length ? { diffs } : {} });
      tagProviderMessage(c, m, u);
      if (u.toolCallId) c.tools.set(providerMessageKey(u.toolCallId, u.providerSessionId), m.id);
      break;
    }
    case "tool_call_update": {
      const m = byId(c, c.tools.get(providerMessageKey(u.toolCallId, u.providerSessionId)) || null);
      if (!m) {
        project(c, { ...u, sessionUpdate: "tool_call" });
        break;
      }
      tagProviderMessage(c, m, u);
      if (u.status) m.payload.status = u.status;
      if (u.title) m.payload.title = u.title;
      const t = textOf(u.content);
      if (t) m.payload.text = t.slice(0, 4e3);
      const diffs = acpDiffs(u.content);
      if (diffs.length) m.payload.diffs = diffs;
      c.dirty.add(m.id);
      break;
    }
    case "plan": {
      closeCurrent(c, false);
      const text = (u.entries || []).map((e) => `${e.status === "completed" ? "✓" : e.status === "in_progress" ? "→" : "·"} ${e.content}`).join("\n");
      const last = c.messages[c.messages.length - 1];
      if (last && last.kind === "plan" && !u.replayed) {
        last.payload.text = text;
        c.dirty.add(last.id);
      } else tagProviderMessage(c, add(c, "plan", { text }), u);
      break;
    }
    case "_hato_notice":
      add(c, "system", { text: u.text });
      break;
    default:
      break;
  }
}
function toChat(m) {
  return { ...chatContent(m), at: m.payload?.recordedAt ?? m.createdAt };
}
function chatContent(m) {
  const p = m.payload || {};
  const display = transcriptContent(String(p.text || ""), p.images || []);
  switch (m.kind) {
    case "user":
      return { key: m.id, role: "user", text: display.text, images: display.images };
    case "assistant":
      return { key: m.id, role: "assistant", text: display.text, images: display.images };
    case "thought":
      return { key: m.id, role: "thought", text: reasoningMarkdown(display.text) };
    case "tool":
      return {
        key: m.id,
        role: "tool",
        title: p.title,
        status: p.status,
        text: display.text.slice(0, 1500),
        ...captureOn && chatPrefs.inlineDiffs && Array.isArray(p.diffs) && p.diffs.length ? { diffs: p.diffs } : {}
      };
    case "plan":
      return { key: m.id, role: "plan", text: display.text };
    case "error":
      return { key: m.id, role: "error", text: display.text };
    default:
      return { key: m.id, role: "system", text: display.text };
  }
}
async function update(ctx, id, fields) {
  await ctx.modules.call("persistence", "conversations.update", { id, fields });
  const c = convs.get(id);
  if (c) c.row = { ...c.row, ...fields };
}
async function configuredMcps(ctx) {
  return (await ctx.modules.call("persistence", "settings.get", { key: "persistent-agents.mcps" }) || []).filter((m) => m.enabled !== false);
}
async function connect(ctx, id) {
  if (connections.has(id)) return connections.get(id);
  if (providerOperations.has(id)) throw new Error("A provider operation is running");
  const task = connectConversation(ctx, id);
  connections.set(id, task);
  try {
    return await task;
  } finally {
    connections.delete(id);
  }
}
async function connectConversation(ctx, id) {
  markerPrompted.delete(id);
  const c = await load(ctx, id);
  await update(ctx, id, { status: "connecting" });
  notify();
  try {
    const selected = new Set(c.row.mcpSelection || []);
    const servers = (await configuredMcps(ctx)).filter((m) => selected.has(m.id));
    const mcpServers = [];
    for (const server of servers) {
      let authorization;
      if (transportOf(server) !== "stdio" && server.auth?.type === "oauth") {
        try {
          authorization = await ctx.modules.call("mcp-auth", "authorization", { serverId: server.id, url: server.url }, { timeoutMs: 6e4 });
        } catch (e) {
          throw new Error(`MCP server “${server.name}” needs sign-in: open Manage MCP servers and choose Sign in (${errMsg(e)})`);
        }
      }
      mcpServers.push(acpServer(server, authorization));
    }
    const st = await ctx.modules.call("acp", "start", {
      conversationId: id,
      workspaceId: c.row.workspaceId,
      profileId: c.row.acpProfileId,
      mcp: selected.has("internal"),
      mcpServers,
      mcpSelection: [...selected].filter((id2) => id2 === "internal" || servers.some((m) => m.id === id2)),
      resumeSessionId: c.row.providerSessionId,
      systemPrompt: selected.has("internal") ? "" : PROGRESS_MARKER_INSTRUCTION
    }, { timeoutMs: 6e5 });
    c.live = st;
    const lostSession = c.row.providerSessionId && st.sessionId !== c.row.providerSessionId;
    await update(ctx, id, { status: "online", providerSessionId: st.sessionId, ...lostSession ? { config: { ...c.row.config, __hatoHandoff: true } } : {} });
    const saved = c.row.config || {};
    for (const [configId, value] of Object.entries(saved)) {
      const known = (st.configOptions || []).some((o) => o.id === configId && (o.options || []).some((x) => x.value === value || (x.options || []).some((y) => y.value === value)));
      if (known && (st.configOptions || []).find((o) => o.id === configId)?.currentValue !== value) {
        try {
          c.live = await ctx.modules.call("acp", "setConfig", { conversationId: id, configId, value });
        } catch (e) {
          ctx.log.warn("re-apply config", configId, errMsg(e));
        }
      }
    }
    return st;
  } catch (e) {
    await update(ctx, id, { status: "error" });
    add(c, "error", { text: errMsg(e) });
    flushSoon();
    throw e;
  } finally {
    notify();
  }
}
async function reconnectAfterAuth(ctx, id) {
  const c = convs.get(id);
  if (!c || c.busy || c.submitting || c.steering.length || c.row.status === "connecting") throw new Error("Finish the active turn before reconnecting after authentication");
  await ctx.modules.call("acp", "stop", { conversationId: id });
  c.live = null;
  c.busy = false;
  return connect(ctx, id);
}
async function providerSessionMutation(ctx, a, method) {
  const id = a.conversationId;
  if (providerOperations.has(id) || connections.has(id)) throw new Error("A provider operation is running");
  providerOperations.add(id);
  try {
    return await mutateProviderSession(ctx, a, method);
  } finally {
    providerOperations.delete(id);
  }
}
async function mutateProviderSession(ctx, a, method) {
  const c = await load(ctx, a.conversationId);
  if (c.busy || c.submitting || c.steering.length || c.row.status === "connecting" || c.live?.status === "starting" || c.live?.authProcess) {
    throw new Error("Finish the active turn, session load, or authentication before changing provider sessions");
  }
  closeCurrent(c);
  c.replay = [];
  c.replayKeys = /* @__PURE__ */ new Map();
  const result = await ctx.modules.call("acp", method, { ...a, conversationId: c.row.id }, { timeoutMs: 15e4 });
  c.live = result || await ctx.modules.call("acp", "state", { conversationId: c.row.id });
  const sessionId = c.live?.sessionClosed ? null : c.live?.sessionId || null;
  await update(ctx, c.row.id, { providerSessionId: sessionId, status: c.live?.sessionClosed ? "offline" : "online", ...c.live?.sessionClosed || method === "newSession" ? { config: { ...c.row.config, __hatoHandoff: true } } : {} });
  notify();
  return c.live;
}
async function loadOlderPage(ctx, c) {
  if (c.historyLoading || !c.hasOlder || !c.oldestSequence) return { loaded: 0, hasOlder: c.hasOlder };
  c.historyLoading = true;
  c.historyError = null;
  notify();
  try {
    const rows = await ctx.modules.call("persistence", "messages.list", { conversationId: c.row.id, beforeSequence: c.oldestSequence, limit: HISTORY_PAGE + 1 });
    const page = rows.slice(-HISTORY_PAGE);
    const known = new Set(c.messages.map((m) => m.id));
    const older = page.filter((m) => !known.has(m.id)).map((m) => ({ id: m.id, sequence: m.sequence, kind: m.kind, payload: m.payload }));
    c.messages = [...older, ...c.messages];
    c.oldestSequence = page[0]?.sequence ?? c.oldestSequence;
    c.hasOlder = rows.length > HISTORY_PAGE;
    for (const m of older) {
      if (m.kind === "tool" && m.payload.toolCallId && !c.tools.has(providerMessageKey(m.payload.toolCallId, m.payload.providerSessionId))) c.tools.set(providerMessageKey(m.payload.toolCallId, m.payload.providerSessionId), m.id);
      if (typeof m.payload.providerMessageId === "string" && m.payload.providerMessageId) {
        const key = providerMessageKey(m.payload.providerMessageId, m.payload.providerSessionId, m.kind);
        c.providerMessages.set(key, m.id);
        c.closedMessages.add(key);
      }
    }
    return { loaded: older.length, hasOlder: c.hasOlder };
  } catch (e) {
    c.historyError = errMsg(e);
    throw e;
  } finally {
    c.historyLoading = false;
    notify();
  }
}
var mod = {
  id: "ai-sessions",
  moduleApiVersion: 1,
  async activate(ctx) {
    progressChanged = debounce(() => ctx.state.set("ai-sessions.progress", Object.fromEntries(progress)), 150);
    historyMcp = exportMcpTools(ctx, "Chat history", [{
      name: "history",
      description: "Read original user and assistant messages from this conversation only. Bounded to 20 messages and 16k characters; use beforeSequence to page earlier. Tool logs, thoughts and image data are excluded.",
      inputSchema: { type: "object", properties: { beforeSequence: { type: "integer", minimum: 1 } }, additionalProperties: false },
      annotations: { readOnlyHint: true },
      handler: async (a, scope) => {
        const c = await load(ctx, scope.conversationId);
        if (c.row.workspaceId !== scope.workspaceId) throw new Error("Conversation belongs to another workspace");
        if (a.beforeSequence !== void 0 && (!Number.isSafeInteger(a.beforeSequence) || a.beforeSequence < 1)) throw new Error("Invalid history cursor");
        const rows = await ctx.modules.call("persistence", "messages.list", { conversationId: c.row.id, beforeSequence: a.beforeSequence, limit: 21 });
        let budget = 16e3;
        const messages = [];
        for (const m of rows.slice(-20).reverse()) {
          if (budget <= 0) break;
          if (m.kind !== "user" && m.kind !== "assistant") continue;
          const original = String(m.payload?.text || "");
          const text = original.slice(0, Math.min(4e3, budget));
          budget -= text.length;
          messages.unshift({ sequence: m.sequence, role: m.kind, text, truncated: text.length < original.length });
        }
        return { messages, beforeSequence: messages[0]?.sequence ?? rows.slice(-20)[0]?.sequence ?? null, hasOlder: rows.length > 20 || budget <= 0 };
      }
    }]);
    sessionContext = ctx;
    captureOn = captureEnabled(ctx);
    ctx.state.watch("files.changesEnabled", () => {
      captureOn = captureEnabled(ctx);
      notify();
    });
    ctx.events.on("files.changeCaptured", () => notify());
    notify = debounce(() => {
      publishActivity(ctx);
      ctx.events.emit("ai-sessions.changed", {});
    }, 60);
    try {
      const saved = await ctx.modules.call("persistence", "settings.get", { key: CHAT_PREFS_KEY });
      if (typeof saved?.inlineDiffs === "boolean") chatPrefs = { ...chatPrefs, inlineDiffs: saved.inlineDiffs };
    } catch (e) {
      ctx.log.warn("load chat preferences", errMsg(e));
    }
    ctx.state.set("ai-sessions.chatPrefs", chatPrefs);
    exportSettings(ctx, () => [{ key: "chat", title: "Chat", group: "AI & tools", fields: [
      {
        key: "inlineDiffs",
        type: "toggle",
        label: "Show inline diffs",
        value: chatPrefs.inlineDiffs,
        description: "When an agent edits files, show the changed lines inside its tool card in the chat."
      }
    ] }], async (_section, key, value) => {
      if (key !== "inlineDiffs" || typeof value !== "boolean") return;
      chatPrefs = { ...chatPrefs, inlineDiffs: value };
      ctx.state.set("ai-sessions.chatPrefs", chatPrefs);
      await ctx.modules.call("persistence", "settings.set", { key: CHAT_PREFS_KEY, value: chatPrefs });
      notify();
    }, { invalidate: false });
    ctx.events.on("persistent-agents.mcpsChanged", () => notify());
    publishActivity(ctx);
    flushSoon = debounce(() => {
      void flush(ctx).catch((e) => ctx.log.warn("persist messages", errMsg(e)));
    }, 1200);
    ctx.events.on("acp.update", (p) => projectInOrder(p.conversationId, async () => {
      const c = convs.get(p.conversationId);
      if (!c) return;
      const update2 = { ...p.update, providerSessionId: p.sessionId || c.row.providerSessionId || "" };
      if (p.replayed) stageReplay(c, update2, update2.providerSessionId);
      else {
        await commitReplay(ctx, c);
        project(c, update2);
      }
      flushSoon();
      notify();
    }));
    ctx.events.on("acp.replayEnded", (p) => projectInOrder(p.conversationId, async () => {
      const c = convs.get(p.conversationId);
      if (!c) return;
      if (p.success === false) {
        c.replay = [];
        c.replayKeys = /* @__PURE__ */ new Map();
      } else await commitReplay(ctx, c);
      flushSoon();
      notify();
    }));
    ctx.events.on("acp.turnEnded", async (p) => {
      const c = convs.get(p.conversationId);
      if (!c) return;
      await projections.get(p.conversationId);
      c.busy = c.steering.length > 0;
      c.submitting = c.busy;
      closeCurrent(c);
      if (p.error) add(c, "error", { text: `Turn failed: ${p.error}` });
      else if (p.stopReason && p.stopReason !== "end_turn") add(c, "system", { text: `Turn ended: ${p.stopReason}` });
      await flush(ctx);
      ctx.events.emit("ai-sessions.captureEnded", { workspaceId: c.row.workspaceId, sessionId: c.row.id });
      if (c.steering.length) {
        const pending = c.steering.splice(0);
        const text = pending.map((p2) => p2.text).filter(Boolean).join("\n\n");
        const images = pending.flatMap((p2) => p2.images);
        c.busy = true;
        c.submitting = true;
        try {
          await ctx.modules.call("acp", "prompt", { conversationId: c.row.id, text, images });
        } catch (e) {
          c.busy = false;
          add(c, "error", { text: `Steering failed: ${errMsg(e)}` });
          flushSoon();
        } finally {
          c.submitting = false;
        }
      }
      notify();
    });
    ctx.events.on("acp.status", (s) => {
      const c = convs.get(s.conversationId);
      if (!c) return;
      c.live = s;
      if (s.sessionId && s.sessionId !== c.row.providerSessionId) update(ctx, s.conversationId, { providerSessionId: s.sessionId }).catch(() => {
      });
      c.busy = s.status === "busy" || c.steering.length > 0 || c.submitting;
      if (s.status === "exited" || s.status === "error") update(ctx, s.conversationId, { status: s.status === "exited" ? "offline" : "error" }).catch(() => {
      });
      notify();
    });
    ctx.events.on("acp.authCompleted", async (p) => {
      if (p.cancelled || p.code !== 0 || p.signal != null) return;
      const c = convs.get(p.conversationId);
      if (!c || c.busy || c.submitting || c.steering.length || c.row.status === "connecting") return;
      add(c, "system", { text: "Authentication completed; reconnecting the agent…" });
      flushSoon();
      notify();
      try {
        await reconnectAfterAuth(ctx, c.row.id);
      } catch (e) {
        await update(ctx, c.row.id, { status: "error" });
        add(c, "error", { text: `Authentication succeeded but reconnect failed: ${errMsg(e)}` });
        flushSoon();
        notify();
      }
    });
  },
  canSwap() {
    return connections.size || providerOperations.size || projections.size || historyMcp?.pending() || Array.from(convs.values()).some((c) => c.busy || c.submitting || c.steering.length || c.historyLoading || c.replay.length) ? { ok: false, reason: "Wait for active chat turns and steering to finish" } : { ok: true };
  },
  async deactivate(ctx) {
    await flush(ctx);
  },
  methods: {
    async list(ctx, a) {
      return ctx.modules.call("persistence", "conversations.list", { workspaceId: a.workspaceId });
    },
    async remove(ctx, a) {
      const row = await ctx.modules.call("persistence", "conversations.get", { id: a.conversationId });
      if (!row || row.workspaceId !== a.workspaceId) throw new Error("Chat does not belong to this workspace");
      const c = await load(ctx, row.id);
      if (deleting.has(row.id)) throw new Error("This chat is being deleted");
      if (c.busy || c.submitting || c.steering.length || c.historyLoading || c.row.status === "connecting" || c.live?.status === "starting") throw new Error("Finish or stop this chat before deleting it");
      deleting.add(row.id);
      try {
        await ctx.modules.call("acp", "stop", { conversationId: row.id });
        c.live = null;
        await update(ctx, row.id, { status: "offline" });
        await flush(ctx);
        await ctx.modules.call("persistence", "conversations.remove", { id: row.id, workspaceId: row.workspaceId });
        convs.delete(row.id);
        progress.delete(row.id);
        markerPrompted.delete(row.id);
        ctx.state.set("ai-sessions.progress", Object.fromEntries(progress));
        notify();
        return null;
      } finally {
        deleting.delete(row.id);
      }
    },
    async create(ctx, a) {
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const profiles = await ctx.modules.call("acp", "profiles", { machineId: desc.machineId });
      const existing = await ctx.modules.call("persistence", "conversations.list", { workspaceId: desc.id });
      const preferences = await ctx.modules.call("workspace", "view.get", { workspaceId: desc.id });
      const previous = existing.find((c) => c.id === preferences.activeConversationId) || existing[0];
      const preferred = a.profileId || previous?.acpProfileId || preferences.ui?.lastAcpProfileId;
      const profileId = profiles.find((p) => p.id === preferred)?.id || profiles[0]?.id;
      if (!profileId) throw new Error(`no agent profile configured for ${desc.machineId}`);
      const source = previous && previous.acpProfileId === profileId ? previous : null;
      const config = { ...source?.config || {} };
      delete config.__hatoHandoff;
      const live = source && convs.get(source.id)?.live;
      for (const option of live?.configOptions || []) {
        if (option.currentValue != null) config[option.id] = option.currentValue;
      }
      const id = crypto.randomUUID();
      await ctx.modules.call("persistence", "conversations.insert", { conversation: { id, workspaceId: desc.id, acpProfileId: profileId, title: a.title || `Chat ${existing.length + 1}`, approvalPolicy: previous?.approvalPolicy || "ask", mcpSelection: [...previous?.mcpSelection || ["internal"]], config } });
      await ctx.modules.call("workspace", "view.patch", { workspaceId: desc.id, patch: { activeConversationId: id, ui: { lastAcpProfileId: profileId } } });
      notify();
      return ctx.modules.call("persistence", "conversations.get", { id });
    },
    async select(ctx, a) {
      await ctx.modules.call("workspace", "view.patch", { workspaceId: a.workspaceId, patch: { activeConversationId: a.conversationId } });
      notify();
      return null;
    },
    /** Tools an MCP server offers to desktop chats: Hato's own from internal-mcp, remote servers over HTTP. */
    async mcpTools(ctx, a) {
      const id = String(a.serverId || "");
      if (id === "internal") return { tools: await ctx.modules.call("internal-mcp", "tools", {}) };
      const server = (await configuredMcps(ctx)).find((m) => m.id === id);
      if (!server) throw new Error("Unknown MCP server");
      if (transportOf(server) === "stdio") throw new Error("Local (command) servers start on the agent's machine when it connects; their tools can't be listed from here yet.");
      return ctx.modules.call("mcp-auth", "listTools", { serverId: server.id, url: server.url, transport: server.transport, headers: server.headers, auth: server.auth }, { timeoutMs: 9e4 });
    },
    /** Everything the AI panel needs for the given workspace, in one call. */
    async view(ctx, a) {
      await Promise.all([...projections.values()]);
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const list = await ctx.modules.call("persistence", "conversations.list", { workspaceId: desc.id });
      const v = await ctx.modules.call("workspace", "view.get", { workspaceId: desc.id });
      const activeId = list.some((x) => x.id === v.activeConversationId) ? v.activeConversationId : list[0] ? list[0].id : null;
      const profiles = await ctx.modules.call("acp", "profiles", { machineId: desc.machineId });
      let active = null;
      if (activeId) {
        const c = await load(ctx, activeId);
        const windowed = Number.isSafeInteger(a.messageLimit) && a.messageLimit > 0;
        const window = messageWindow(
          c.messages,
          windowed ? Math.min(a.messageLimit, 200) : c.messages.length,
          !a.windowConversationId || a.windowConversationId === activeId ? a.beforeMessageId : void 0
        );
        active = {
          conversation: c.row,
          messages: chatPrefs.inlineDiffs && captureOn ? capturedTranscript(window.messages.map(toChat), capturedChanges(ctx, desc.id), "chat", activeId) : window.messages.map(toChat),
          windowed,
          hasLoadedOlder: window.hasLoadedOlder,
          hasNewer: window.hasNewer,
          hasOlder: c.hasOlder || window.hasLoadedOlder,
          historyLoading: c.historyLoading,
          historyError: c.historyError,
          live: c.live,
          busy: c.busy,
          steering: c.steering.length
        };
      }
      const auth = await ctx.modules.call("acp", "authSettings", {});
      return { mcpServers: [{ id: "internal", name: "Hato", description: "Inspect, build and reload application modules" }, ...(await configuredMcps(ctx)).map((m) => ({ id: m.id, name: m.name, description: transportOf(m) === "stdio" ? "Runs on the workspace machine" : "Remote MCP server" }))], auth, workspace: { id: desc.id, name: desc.name, machineId: desc.machineId, root: desc.rootAbsolutePath, location: desc.location }, conversations: list.map((x) => ({ id: x.id, title: x.title, status: convs.get(x.id)?.busy ? "busy" : x.status, acpProfileId: x.acpProfileId, updatedAt: x.updatedAt })), activeId, active, profiles };
    },
    /** Prompts in this workspace's chats with the files each turn edited (prompt-history panel). */
    async promptHistory(ctx, a) {
      const messageLimit = Math.max(50, Math.min(Number(a?.messageLimit) || 400, 3e3));
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      await flush(ctx);
      const list = (await ctx.modules.call("persistence", "conversations.list", { workspaceId: desc.id })).slice(0, 40);
      const names = /* @__PURE__ */ new Map();
      try {
        for (const p of await ctx.modules.call("acp", "profiles", { machineId: desc.machineId })) names.set(p.id, p.name || p.id);
      } catch {
      }
      const entries = [];
      for (const conv of list) {
        const rows = await ctx.modules.call("persistence", "messages.list", { conversationId: conv.id, limit: messageLimit });
        entries.push(...promptTurns(rows.filter((m) => m.kind === "user" || m.kind === "tool").map((m) => ({
          key: m.id,
          role: m.kind,
          at: epochOf(m.createdAt),
          text: m.kind === "user" ? transcriptContent(String(m.payload?.text || ""), []).text : void 0,
          diffs: Array.isArray(m.payload?.diffs) ? m.payload.diffs : void 0
        })), { source: "chat", sessionId: conv.id, sessionTitle: conv.title || "Chat", agent: names.get(conv.acpProfileId) || conv.acpProfileId || "Agent" }));
      }
      return { entries };
    },
    async loadOlder(ctx, a) {
      const c = await load(ctx, a.conversationId);
      await projections.get(c.row.id);
      if (c.historyLoading) return { loaded: 0, hasOlder: c.hasOlder };
      const task = loadOlderPage(ctx, c);
      historyLoads.set(c.row.id, task);
      try {
        return await task;
      } finally {
        if (historyLoads.get(c.row.id) === task) historyLoads.delete(c.row.id);
      }
    },
    connect: (ctx, a) => connect(ctx, a.conversationId),
    async disconnect(ctx, a) {
      await ctx.modules.call("acp", "stop", { conversationId: a.conversationId });
      await update(ctx, a.conversationId, { status: "offline" });
      const c = convs.get(a.conversationId);
      if (c) {
        c.live = null;
        c.busy = false;
        c.steering = [];
      }
      notify();
      return null;
    },
    async send(ctx, a) {
      if (providerOperations.has(a.conversationId)) throw new Error("A provider operation is running");
      await projections.get(a.conversationId);
      const text = String(a.text || "").trim();
      const images = imageAttachments(a.images);
      if (!text && !images.length) throw new Error("empty prompt");
      const c = await load(ctx, a.conversationId);
      if (images.length && c.live && !c.live.agentCapabilities?.promptCapabilities?.image) throw new Error("This agent does not support image prompts.");
      if (c.submitting) throw new Error("The previous message is still being submitted. Try again in a moment.");
      if (c.busy && c.steering.length === 0) {
        let outcome = "unsupported";
        try {
          outcome = (await ctx.modules.call("acp", "steer", { conversationId: c.row.id, text, images })).outcome;
        } catch (e) {
          ctx.log.warn("steering failed; falling back to interrupt", errMsg(e));
        }
        if (outcome === "steered") {
          add(c, "user", { text, images });
          notify();
          await flush(ctx);
          return { accepted: true, steering: true };
        }
        if (outcome === "promptRequired" && c.busy) {
          c.steering.push({ text, images });
          add(c, "user", { text, images });
          notify();
          await flush(ctx);
          return { accepted: true, steering: true };
        }
      }
      if (c.busy) {
        const first = c.steering.length === 0;
        imageAttachments([...c.steering.flatMap((p) => p.images), ...images]);
        c.steering.push({ text, images });
        add(c, "user", { text, images });
        notify();
        if (first) {
          try {
            await ctx.modules.call("acp", "cancel", { conversationId: c.row.id });
          } catch (e) {
            c.steering = [];
            add(c, "error", { text: `Could not interrupt the agent: ${errMsg(e)}. Send your follow-up again.` });
            flushSoon();
            notify();
            throw e;
          }
        }
        await flush(ctx);
        return { accepted: true, steering: true };
      }
      c.submitting = true;
      try {
        if (images.length) {
          if (!c.live || (!["ready", "busy"].includes(c.live.status) || c.live.sessionClosed || !c.live.sessionId)) await connect(ctx, c.row.id);
          if (!c.live?.agentCapabilities?.promptCapabilities?.image) throw new Error("This agent does not support image prompts.");
        }
        const previousMessages = c.messages.slice();
        const userRow = add(c, "user", { text, images });
        closeCurrent(c);
        if (c.row.title.startsWith("Chat ") && c.messages.filter((m) => m.kind === "user").length === 1) await update(ctx, c.row.id, { title: text.slice(0, 60) || images[0]?.name || "Picture" });
        await flush(ctx);
        notify();
        if (!c.live || (!["ready", "busy"].includes(c.live.status) || c.live.sessionClosed || !c.live.sessionId)) await connect(ctx, c.row.id);
        c.busy = true;
        notify();
        try {
          const transfer = c.row.config?.__hatoHandoff ? chatHandoff(previousMessages.map((m) => ({ role: m.kind, text: String(m.payload?.text || "") }))) : "";
          const marker = !(c.row.mcpSelection || []).includes("internal") && !c.live?.agentCapabilities?.sessionCapabilities?.systemPrompt && !markerPrompted.has(c.row.id) ? PROGRESS_MARKER_INSTRUCTION : "";
          if (marker) markerPrompted.add(c.row.id);
          if (progress.delete(c.row.id)) progressChanged();
          const body = transfer ? `${transfer}

Current user request:
${text}` : text;
          const outgoingText = marker ? `${marker}

${body}` : body;
          userRow.payload.outgoingText = outgoingText;
          c.dirty.add(userRow.id);
          await flush(ctx);
          await ctx.modules.call("acp", "prompt", { conversationId: c.row.id, text: outgoingText, images });
          if (c.row.config?.__hatoHandoff) {
            const config = { ...c.row.config };
            delete config.__hatoHandoff;
            await update(ctx, c.row.id, { config });
          }
        } catch (e) {
          c.busy = false;
          add(c, "error", { text: errMsg(e) });
          flushSoon();
          notify();
          throw e;
        }
        return { accepted: true };
      } finally {
        c.submitting = false;
      }
    },
    async cancel(ctx, a) {
      const c = await load(ctx, a.conversationId);
      c.steering = [];
      await ctx.modules.call("acp", "cancel", { conversationId: a.conversationId });
      return null;
    },
    async setConfig(ctx, a) {
      const c = await load(ctx, a.conversationId);
      c.live = await ctx.modules.call("acp", "setConfig", { conversationId: a.conversationId, configId: a.configId, value: a.value });
      await update(ctx, a.conversationId, { config: { ...c.row.config || {}, [a.configId]: a.value } });
      notify();
      return c.live;
    },
    async setPolicy(ctx, a) {
      const p = a.policy === "autopilot" ? "autopilot" : a.policy === "auto-low" ? "auto-low" : "ask";
      await load(ctx, a.conversationId);
      await update(ctx, a.conversationId, { approvalPolicy: p });
      add(convs.get(a.conversationId), "system", { text: p === "autopilot" ? "Autopilot enabled: agent tool permissions are approved automatically. Module patch/build/activate/rollback still require native approval." : p === "auto-low" ? "Auto-approving low-risk agent actions (read/search/think/fetch); others ask." : "All agent permission requests ask for approval." });
      flushSoon();
      notify();
      return null;
    },
    async setMcp(ctx, a) {
      const c = await load(ctx, a.conversationId);
      const id = typeof a.serverId === "string" ? a.serverId : "internal";
      const enabled = typeof a.serverId === "string" ? !!a.enabled : !!a.internal;
      if (enabled && id !== "internal" && !(await configuredMcps(ctx)).some((m) => m.id === id)) throw new Error("Unknown or disabled MCP server");
      const selection = new Set(c.row.mcpSelection || []);
      if (enabled) selection.add(id);
      else selection.delete(id);
      await update(ctx, a.conversationId, { mcpSelection: [...selection] });
      notify();
      return { reconnectRequired: true };
    },
    async setProfile(ctx, a) {
      const c = await load(ctx, a.conversationId);
      if (c.row.acpProfileId === a.profileId) return null;
      if (c.busy || c.submitting || c.steering.length || c.row.status === "connecting" || c.live?.status === "starting" || c.live?.status === "busy") {
        throw new Error("Wait for the agent to finish or stop its turn before switching providers.");
      }
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: c.row.workspaceId });
      const profiles = await ctx.modules.call("acp", "profiles", { machineId: desc.machineId });
      if (!profiles.some((p) => p.id === a.profileId)) throw new Error("provider is unavailable for this workspace");
      if (c.busy || c.submitting || c.steering.length || c.row.status === "connecting" || c.live?.status === "starting" || c.live?.status === "busy") {
        throw new Error("Wait for the agent to finish or stop its turn before switching providers.");
      }
      if (c.live && ["ready", "busy"].includes(c.live.status)) await ctx.modules.call("acp", "stop", { conversationId: a.conversationId });
      c.live = null;
      c.busy = false;
      await ctx.modules.call("workspace", "view.patch", { workspaceId: c.row.workspaceId, patch: { ui: { lastAcpProfileId: a.profileId } } });
      await update(ctx, a.conversationId, { acpProfileId: a.profileId, providerSessionId: null, status: "offline", config: { __hatoHandoff: true } });
      notify();
      return null;
    },
    providerSessions: (ctx, a) => ctx.modules.call("acp", "listSessions", { conversationId: a.conversationId, cursor: a.cursor }, { timeoutMs: 9e4 }),
    newProviderSession: (ctx, a) => providerSessionMutation(ctx, a, "newSession"),
    resumeProviderSession: (ctx, a) => providerSessionMutation(ctx, a, "resumeSession"),
    loadProviderSession: (ctx, a) => providerSessionMutation(ctx, a, "loadSession"),
    forkProviderSession: (ctx, a) => providerSessionMutation(ctx, a, "forkSession"),
    closeProviderSession: (ctx, a) => providerSessionMutation(ctx, a, "closeSession"),
    deleteProviderSession: (ctx, a) => providerSessionMutation(ctx, a, "deleteSession"),
    async authenticate(ctx, a) {
      const c = await load(ctx, a.conversationId);
      const result = await ctx.modules.call("acp", "authenticate", { conversationId: c.row.id, methodId: a.methodId, confirmToken: a.confirmToken }, { timeoutMs: 15e4 });
      c.live = await ctx.modules.call("acp", "state", { conversationId: c.row.id });
      notify();
      if (result?.outcome === "authenticated") await reconnectAfterAuth(ctx, c.row.id);
      return result;
    },
    async authInput(ctx, a) {
      await load(ctx, a.conversationId);
      return ctx.modules.call("acp", "authInput", { conversationId: a.conversationId, data: String(a.data || ""), attemptId: a.attemptId });
    },
    async cancelAuth(ctx, a) {
      await load(ctx, a.conversationId);
      const result = await ctx.modules.call("acp", "cancelAuth", { conversationId: a.conversationId, attemptId: a.attemptId });
      const c = convs.get(a.conversationId);
      if (c) c.live = await ctx.modules.call("acp", "state", { conversationId: a.conversationId });
      notify();
      return result;
    },
    async respondElicitation(ctx, a) {
      const c = await load(ctx, a.conversationId);
      return ctx.modules.call("acp", "respondElicitation", { conversationId: c.row.id, requestId: a.requestId, response: a.response });
    },
    adapters: (ctx, a) => ctx.modules.call("acp", "adapters", { workspaceId: a.workspaceId }, { timeoutMs: 3e5 }),
    /** User-initiated install/update of a known adapter, confirmed in a native dialog first. */
    async installAdapter(ctx, a) {
      const desc = await ctx.modules.call("workspace", "resolve", { workspaceId: a.workspaceId });
      const list = await ctx.modules.call("acp", "adapters", { workspaceId: desc.id }, { timeoutMs: 3e5 });
      const ad = list.find((x) => x.id === a.adapterId);
      if (!ad) throw new Error(`unknown adapter ${a.adapterId}`);
      const verb = ad.installed ? "Update" : "Install";
      const r = await ctx.host.approvals.request({
        title: `${verb} ${ad.name} on ${desc.machineId}?`,
        operation: "acp-adapter-install",
        detail: [
          `Command (runs on ${desc.machineId}):`,
          `  ${ad.installCommand || `npm install -g ${ad.pkg}@latest`}`,
          "",
          ...ad.prefix ? [`npm's global folder is not writable by this user, so the adapter is installed for this user only (${ad.prefix}/bin). No root access is used.`, ""] : [],
          `Installed: ${ad.installed || "not installed"}   Latest: ${ad.latest || "unknown"}`,
          "",
          "This downloads and installs code from the npm registry. The agent will afterwards still need to be authenticated on that machine."
        ].join("\n"),
        options: [{ id: "allow", label: verb, kind: "allow" }, { id: "deny", label: "Cancel", kind: "deny" }]
      });
      if (r.optionId !== "allow") throw new Error(`${verb} cancelled`);
      return ctx.modules.call("acp", "installAdapter", { workspaceId: desc.id, adapterId: ad.id }, { timeoutMs: 16 * 60 * 1e3 });
    },
    /** Called by `acp` for session/request_permission. */
    async permissionRequest(ctx, a) {
      const c = await load(ctx, a.conversationId);
      const req = a.request || {};
      const options = req.options || [];
      const tool = req.toolCall || {};
      const policy = c.row.approvalPolicy || "ask";
      const allowOnce = options.find((o) => o.kind === "allow_once") || options.find((o) => String(o.kind).startsWith("allow"));
      const reject = options.find((o) => o.kind === "reject_once") || options.find((o) => String(o.kind).startsWith("reject"));
      let chosen = null;
      let how = "";
      if (policy === "autopilot" && allowOnce) {
        chosen = allowOnce.optionId;
        how = "autopilot";
      } else if (policy === "auto-low" && allowOnce && LOW_RISK_KINDS.has(tool.kind)) {
        chosen = allowOnce.optionId;
        how = "auto (low-risk)";
      } else {
        const detail = [
          `Agent: ${c.live?.agentInfo?.title || c.live?.agentInfo?.name || c.row.acpProfileId} on ${c.live?.machineId || "?"}`,
          `Workspace: ${c.row.workspaceId}`,
          `Tool: ${tool.title || "(untitled)"} [${tool.kind || "other"}]`,
          tool.rawInput ? `Input: ${JSON.stringify(tool.rawInput).slice(0, 4e3)}` : "",
          textOf(tool.content).slice(0, 4e3)
        ].filter(Boolean).join("\n");
        const r = await ctx.host.approvals.request({
          title: `Agent requests permission: ${tool.title || tool.kind || "tool call"}`,
          detail,
          operation: "agent-permission",
          options: options.map((o) => ({ id: o.optionId, label: o.name || o.optionId, kind: String(o.kind).startsWith("allow") ? "allow" : String(o.kind).startsWith("reject") ? "deny" : "neutral" }))
        });
        chosen = r.optionId;
        how = r.expired ? "expired" : "user";
      }
      const label = options.find((o) => o.optionId === chosen)?.name || (chosen ? chosen : "cancelled");
      ctx.log.info(`permission "${tool.title || tool.kind || "tool"}": ${label} (${how})`);
      flushSoon();
      notify();
      if (!chosen) return { outcome: { outcome: "cancelled" } };
      if (reject && chosen === reject.optionId) return { outcome: { outcome: "selected", optionId: chosen } };
      return { outcome: { outcome: "selected", optionId: chosen } };
    }
  }
};
var index_default = mod;
export {
  index_default as default
};
