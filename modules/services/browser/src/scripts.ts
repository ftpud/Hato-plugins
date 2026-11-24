// Page-side helpers evaluated through Runtime.evaluate. Kept as plain function sources so they run
// in any page without injected libraries. Element refs are stamped as `data-hato-ref` attributes
// so later actions target the same node even if the page reorders. Every helper shares PRELUDE,
// which also searches open shadow roots and same-origin iframes and reports top-level viewport
// coordinates for elements inside frames.

const PRELUDE = String.raw`
const roots = [document];
(function collect(doc, depth) {
  if (depth > 6) return;
  for (const el of doc.querySelectorAll("*")) {
    if (el.shadowRoot) { roots.push(el.shadowRoot); collect(el.shadowRoot, depth + 1); }
    else if (el.tagName === "IFRAME" || el.tagName === "FRAME") {
      let d = null; try { d = el.contentDocument; } catch (e) {}
      if (d && d.documentElement) { roots.push(d); collect(d, depth + 1); }
    }
  }
})(document, 0);
const qa = sel => { const out = []; for (const r of roots) { try { for (const el of r.querySelectorAll(sel)) out.push(el); } catch (e) { if (r === document) throw e; } } return out; };
const norm = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const win = el => el.ownerDocument.defaultView || window;
const shift = el => { let x = 0, y = 0; try { let w = win(el); while (w && w.frameElement) { const f = w.frameElement, r = f.getBoundingClientRect(); x += r.left + f.clientLeft; y += r.top + f.clientTop; w = w.parent; } } catch (e) {} return { x, y }; };
const rectOf = el => { const r = el.getBoundingClientRect(), s = shift(el); return { left: r.left + s.x, top: r.top + s.y, width: r.width, height: r.height, right: r.right + s.x, bottom: r.bottom + s.y }; };
const visible = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = win(el).getComputedStyle(el); return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) !== 0; };
const INTERACTIVE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=combobox],[role=textbox],[role=searchbox],[role=spinbutton],[role=treeitem],[contenteditable=""],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"])';
const FIELD = 'input:not([type=hidden]),select,textarea,[contenteditable=""],[contenteditable=true],[role=textbox],[role=searchbox],[role=combobox],[role=checkbox],[role=radio],[role=switch],[role=spinbutton]';
const ensureRef = el => {
  let ref = el.getAttribute("data-hato-ref");
  if (!ref) { const root = document.documentElement; const next = Number(root.getAttribute("data-hato-next") || "1"); ref = String(next); el.setAttribute("data-hato-ref", ref); root.setAttribute("data-hato-next", String(next + 1)); }
  return Number(ref);
};
const labelText = l => { const c = l.cloneNode(true); for (const x of c.querySelectorAll("select,textarea,option,input,button,script,style")) x.remove(); return c.textContent; };
const nameOf = el => {
  const aria = el.getAttribute("aria-label"); if (aria && norm(aria)) return norm(aria);
  const by = el.getAttribute("aria-labelledby");
  if (by) { const t = by.split(/\s+/).map(id => { const n = el.ownerDocument.getElementById(id); return n ? (n.innerText || n.textContent) : ""; }).join(" "); if (norm(t)) return norm(t); }
  if (el.labels && el.labels.length) { const t = [...el.labels].map(labelText).join(" "); if (norm(t)) return norm(t); }
  const tag = el.tagName.toLowerCase();
  if (tag === "input" && /^(button|submit|reset)$/.test(el.type) && el.value) return norm(el.value);
  const own = tag === "input" || tag === "textarea" || tag === "select" ? "" : norm(el.innerText || el.textContent);
  return own || norm(el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt") || el.getAttribute("name") || "");
};
const stateOf = el => {
  const s = {}; const tag = el.tagName.toLowerCase(); const type = String(el.type || "").toLowerCase();
  if (tag === "input" || tag === "textarea") {
    if (type === "checkbox" || type === "radio") s.checked = !!el.checked;
    else if (type === "password") s.value = el.value ? "•••" : "";
    else s.value = String(el.value == null ? "" : el.value).slice(0, 200);
  } else if (tag === "select") {
    s.value = el.selectedOptions && el.selectedOptions[0] ? norm(el.selectedOptions[0].text) : "";
  } else if (el.isContentEditable || /^(textbox|searchbox|combobox)$/.test(el.getAttribute("role") || "")) {
    const v = el.value != null && el.value !== "" ? el.value : norm(el.innerText); if (v) s.value = String(v).slice(0, 200);
  }
  const ac = el.getAttribute("aria-checked"); if (ac) s.checked = ac === "true";
  const as = el.getAttribute("aria-selected"); if (as) s.selected = as === "true";
  const ae = el.getAttribute("aria-expanded"); if (ae) s.expanded = ae === "true";
  const ap = el.getAttribute("aria-pressed"); if (ap) s.pressed = ap === "true";
  if (el.disabled || el.getAttribute("aria-disabled") === "true") s.disabled = true;
  if (el.readOnly || el.getAttribute("aria-readonly") === "true") s.readOnly = true;
  if (el.required || el.getAttribute("aria-required") === "true") s.required = true;
  if (el.getAttribute("aria-invalid") === "true" || (el.validity && !el.validity.valid && el.willValidate && s.value)) s.invalid = true;
  try { if (el.ownerDocument.activeElement === el) s.focused = true; } catch (e) {}
  return s;
};
const describe = el => {
  if (!el) return null;
  const d = { tag: el.tagName.toLowerCase(), name: nameOf(el).slice(0, 100), ref: ensureRef(el) };
  const role = el.getAttribute("role"); if (role) d.role = role;
  if (el.tagName === "INPUT") d.type = String(el.type || "").toLowerCase();
  Object.assign(d, stateOf(el));
  try { if (el.matches(":hover")) d.hovered = true; } catch (e) {}
  return d;
};
const deepAt = (x, y) => {
  let doc = document, ox = 0, oy = 0, el = null;
  for (let i = 0; i < 8; i++) {
    el = doc.elementFromPoint(x - ox, y - oy);
    if (!el) return null;
    while (el.shadowRoot && el.shadowRoot.elementFromPoint) { const inner = el.shadowRoot.elementFromPoint(x - ox, y - oy); if (!inner || inner === el) break; el = inner; }
    if ((el.tagName === "IFRAME" || el.tagName === "FRAME")) {
      let d = null; try { d = el.contentDocument; } catch (e) {}
      if (!d) return el;
      const r = el.getBoundingClientRect(); ox += r.left + el.clientLeft; oy += r.top + el.clientTop; doc = d; continue;
    }
    return el;
  }
  return el;
};
const impliedRole = el => {
  const r = el.getAttribute("role"); if (r) return r;
  const tag = el.tagName.toLowerCase(), type = String(el.type || "").toLowerCase();
  if (tag === "a") return "link"; if (tag === "button" || (tag === "input" && /^(button|submit|reset)$/.test(type))) return "button";
  if (tag === "select") return "combobox"; if (tag === "textarea" || (tag === "input" && !/^(checkbox|radio)$/.test(type))) return "textbox";
  if (tag === "input") return type; return "";
};
const rank = (n, want) => { const a = n.toLowerCase(), b = want.toLowerCase(); if (a === b) return 3; if (a.startsWith(b)) return 2; if (a.includes(b)) return 1; return 0; };
// Resolve a target description {ref, selector, name, label, role, nth} to one element.
function resolve(t) {
  if (t.ref) { const m = qa('[data-hato-ref="' + t.ref + '"]'); if (!m.length) return { error: "Element ref " + t.ref + " is gone; list elements again" }; return { el: m[0], matches: 1 }; }
  if (t.selector) {
    const m = qa(t.selector); if (!m.length) return { error: "No element matches " + t.selector };
    const vis = m.filter(visible), pick = vis.length ? vis : m;
    return { el: pick[Math.min(t.nth || 0, pick.length - 1)], matches: pick.length };
  }
  const want = norm(t.label || t.name);
  if (!want) return { error: "Give an element ref, a CSS selector, a name/label or x/y coordinates" };
  let pool = qa(t.label ? FIELD : INTERACTIVE).filter(visible);
  if (t.role) pool = pool.filter(el => impliedRole(el) === t.role);
  let scored = pool.map(el => ({ el, s: rank(nameOf(el), want), len: nameOf(el).length })).filter(c => c.s > 0);
  if (!scored.length && t.label) {
    // Custom form controls: a label-like element followed by a field in the same container.
    for (const l of qa("label,legend,span,div,dt,th,p")) {
      if (l.children.length > 2 || !visible(l) || rank(norm(l.innerText || l.textContent), want) < 2) continue;
      let field = l.control || null;
      for (let up = l, i = 0; !field && up && i < 4; up = up.parentElement, i++) { const f = [...up.querySelectorAll(FIELD)].filter(visible); if (f.length) field = f[0]; }
      if (field) scored.push({ el: field, s: 1, len: 0 });
    }
  }
  if (!scored.length && !t.label) {
    for (const el of qa("*")) {
      if (el.children.length > 3 || !visible(el)) continue;
      const n = norm(el.innerText || el.textContent); if (!n || n.length > 200) continue;
      const s = rank(n, want); if (s > 0) scored.push({ el: el.closest(INTERACTIVE) || el, s, len: n.length });
    }
  }
  if (!scored.length) return { error: 'No visible element named "' + want + '"; use browser_elements to see what is on the page' };
  const best = Math.max(...scored.map(c => c.s));
  let top = scored.filter(c => c.s === best);
  const minLen = Math.min(...top.map(c => c.len)); top = top.filter(c => c.len === minLen);
  const seen = new Set(); top = top.filter(c => !seen.has(c.el) && seen.add(c.el));
  return { el: top[Math.min(t.nth || 0, top.length - 1)].el, matches: top.length };
}
`;

/** Visible text: `viewport` limits to what is currently on screen. Page scope includes same-origin iframes. */
export const TEXT_FN = `function(scope, selector, max) {
  ${PRELUDE}
  let root = document.body;
  if (selector) { const r = resolve({ selector }); if (r.error) return { error: r.error }; root = r.el; }
  const vw = innerWidth, vh = innerHeight;
  if (scope !== "viewport") {
    let t = (root.innerText || "").replace(/\\n{3,}/g, "\\n\\n").trim();
    if (!selector) for (const r of roots) {
      if (r === document || r.nodeType !== 9 || !r.body) continue;
      const f = (r.body.innerText || "").replace(/\\n{3,}/g, "\\n\\n").trim();
      if (f) t += "\\n\\n[iframe]\\n" + f;
    }
    return { text: t.slice(0, max), total: t.length, truncated: t.length > max };
  }
  const out = []; let len = 0; let last = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = n.nodeValue.replace(/\\s+/g, " ").trim();
    if (!s) continue;
    const el = n.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) continue;
    const block = el.closest("p,li,h1,h2,h3,h4,h5,h6,tr,div,section,article,header,footer,nav,td,th,label,button,a") || el;
    out.push((last && last !== block ? "\\n" : " ") + s); last = block;
    len += s.length + 1; if (len > max) break;
  }
  const t = out.join("").replace(/^\\s+/, "").replace(/ \\n/g, "\\n");
  return { text: t.slice(0, max), total: t.length, truncated: len > max };
}`;

/** Interactive elements with refs, names, state and centers (CSS px in the top-level viewport). */
export const ELEMENTS_FN = `function(all, max, fields, selector) {
  ${PRELUDE}
  const vw = innerWidth, vh = innerHeight;
  let list;
  if (selector) { const r = resolve({ selector }); if (r.error) return { error: r.error }; list = [...r.el.querySelectorAll(fields ? FIELD : INTERACTIVE)]; if (r.el.matches(fields ? FIELD : INTERACTIVE)) list.unshift(r.el); }
  else list = qa(fields ? FIELD : INTERACTIVE);
  const out = [];
  for (const el of list) {
    const r = rectOf(el);
    if (r.width < 2 || r.height < 2) continue;
    const cs = win(el).getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || (!fields && cs.pointerEvents === "none")) continue;
    const inView = !(r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw);
    if (!all && !inView) continue;
    const tag = el.tagName.toLowerCase();
    const name = nameOf(el).slice(0, 120);
    const item = { ref: ensureRef(el), tag, role: el.getAttribute("role") || undefined, text: name || norm(el.value).slice(0, 120), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), inView };
    if (tag === "input") item.type = String(el.type || "").toLowerCase();
    Object.assign(item, stateOf(el));
    if (tag === "a") item.href = el.href;
    if (tag === "select") item.options = [...el.options].slice(0, 50).map(o => ({ text: norm(o.text), value: o.value, selected: o.selected || undefined }));
    out.push(item);
    if (out.length >= max) break;
  }
  return { elements: out, viewport: { width: vw, height: vh }, scroll: { x: scrollX, y: scrollY } };
}`;

/** Resolve a target (ref, selector, name/label or point), optionally scroll it into view, and describe it. */
export const LOCATE_FN = `function(t, scroll) {
  ${PRELUDE}
  let el, matches = 1;
  if (typeof t.x === "number" && typeof t.y === "number") {
    el = deepAt(t.x, t.y);
    return { x: t.x, y: t.y, point: true, target: describe(el), editable: el ? !!(el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName)) : undefined };
  }
  const r = resolve(t);
  if (r.error) return { error: r.error };
  el = r.el; matches = r.matches;
  if (scroll) el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const rect = rectOf(el);
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  const out = { x, y, matches, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, target: describe(el), editable: !!(el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName)) };
  const top = deepAt(x, y);
  if (top && top !== el && !el.contains(top) && !top.contains(el)) out.coveredBy = describe(top);
  if (!(rect.width >= 1 && rect.height >= 1)) out.hidden = true;
  return out;
}`;

/** Select all text of an editable target so typing replaces it. */
export const CLEAR_FN = `function(t) {
  ${PRELUDE}
  let el;
  if (t && (t.ref || t.selector || t.name || t.label)) { const r = resolve(t); el = r.el; }
  else {
    el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    while (el && /^i?frame$/i.test(el.tagName)) { let d = null; try { d = el.contentDocument; } catch (e) {} if (!d || !d.activeElement) break; el = d.activeElement; }
  }
  if (!el || el === document.body) return false;
  el.focus();
  if (typeof el.select === "function") { el.select(); return true; }
  if (el.isContentEditable) { const d = el.ownerDocument; const r = d.createRange(); r.selectNodeContents(el); const s = d.defaultView.getSelection(); s.removeAllRanges(); s.addRange(r); return true; }
  return false;
}`;

/** The focused element's current value, so typed input can be verified. */
export const READBACK_FN = `function() {
  ${PRELUDE}
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  while (el && /^i?frame$/i.test(el.tagName)) { let d = null; try { d = el.contentDocument; } catch (e) {} if (!d || !d.activeElement) break; el = d.activeElement; }
  if (!el || el === document.body) return null;
  const s = stateOf(el);
  const typed = el.tagName === "INPUT" ? el.value : el.tagName === "TEXTAREA" ? el.value : el.isContentEditable ? el.innerText : null;
  return { target: describe(el), value: typeof typed === "string" ? (String(el.type).toLowerCase() === "password" ? null : typed) : null, state: s };
}`;

/** Fill or choose an option of a native <select>; {native:false} for custom controls. */
export const SELECT_FN = `function(t, option) {
  ${PRELUDE}
  const r = resolve(t);
  if (r.error) return { error: r.error };
  const el = r.el;
  if (el.tagName !== "SELECT") return { native: false };
  const want = norm(option).toLowerCase();
  const opts = [...el.options];
  let match = opts.find(o => norm(o.text).toLowerCase() === want || o.value.toLowerCase() === want) || opts.find(o => norm(o.text).toLowerCase().includes(want));
  if (!match) return { error: 'No option "' + option + '"', options: opts.slice(0, 50).map(o => norm(o.text)) };
  if (match.disabled) return { error: 'Option "' + norm(match.text) + '" is disabled' };
  el.value = match.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { native: true, selected: norm(match.text), value: match.value };
}`;

/** Find a visible option of an opened custom dropdown/listbox. */
export const OPTION_FN = `function(option) {
  ${PRELUDE}
  const want = norm(option);
  const pool = qa('[role=option],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=treeitem],[role=listitem],[data-value],li,[class*=option i],[class*=item i]').filter(visible);
  const scored = pool.map(el => { const n = norm(el.innerText || el.textContent); return { el, n, s: rank(n, want) }; }).filter(c => c.s > 0 && c.n.length < 300);
  if (!scored.length) return { error: 'No visible option "' + want + '"', available: pool.slice(0, 20).map(el => norm(el.innerText || el.textContent).slice(0, 60)).filter(Boolean) };
  const best = Math.max(...scored.map(c => c.s));
  const top = scored.filter(c => c.s === best).sort((a, b) => a.n.length - b.n.length)[0];
  const rect = rectOf(top.el);
  return { ref: ensureRef(top.el), name: top.n.slice(0, 100), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}`;

/** Scroll position of the container under a point (the page when the point is not in a scroller). */
export const SCROLL_FN = `function(x, y, to) {
  ${PRELUDE}
  const scrollable = el => { const cs = win(el).getComputedStyle(el); return /(auto|scroll|overlay)/.test(cs.overflowY + cs.overflowX) && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1); };
  let el = deepAt(x, y), box = null;
  for (; el && el !== document.documentElement && el !== document.body; el = el.parentElement || (el.getRootNode && el.getRootNode().host) || null) {
    if (scrollable(el)) { box = el; break; }
  }
  const page = { x: Math.round(scrollX), y: Math.round(scrollY), height: document.documentElement.scrollHeight, viewportHeight: innerHeight };
  if (!box) {
    if (to) window.scrollTo(page.x, to === "top" ? 0 : document.documentElement.scrollHeight);
    const y2 = Math.round(scrollY);
    return to ? { target: "page", x: Math.round(scrollX), y: y2, height: page.height, viewportHeight: page.viewportHeight, atTop: y2 <= 0, atBottom: y2 + innerHeight >= page.height - 1 } : { target: "page", ...page, atTop: page.y <= 0, atBottom: page.y + innerHeight >= page.height - 1 };
  }
  if (to) box.scrollTop = to === "top" ? 0 : box.scrollHeight;
  return { target: describe(box), x: Math.round(box.scrollLeft), y: Math.round(box.scrollTop), height: box.scrollHeight, viewportHeight: box.clientHeight,
    atTop: box.scrollTop <= 0, atBottom: box.scrollTop + box.clientHeight >= box.scrollHeight - 1, page };
}`;

/** Readiness signals: document state, DOM quiet time, busy indicators and the focused element. */
export const PAGE_STATE_FN = `function() {
  ${PRELUDE}
  if (!window.__hatoQuiet) {
    const st = window.__hatoQuiet = { last: performance.now() };
    try { new MutationObserver(() => { st.last = performance.now(); }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden", "aria-busy", "aria-hidden", "disabled", "open"] }); } catch (e) {}
  }
  let busy = false, busyReason;
  if (document.querySelector('[aria-busy="true"]')) { busy = true; busyReason = "aria-busy element present"; }
  else {
    const hits = qa('[role=progressbar],[class*="spinner" i],[class*="skeleton" i],[class*="loading" i],[class*="loader" i],[class*="shimmer" i]');
    for (let i = 0, n = 0; i < hits.length && n < 40; i++, n++) {
      const el = hits[i], r = rectOf(el);
      if (r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight && visible(el)) { busy = true; busyReason = "loading indicator visible (" + (el.getAttribute("role") || String(el.className).slice(0, 40)) + ")"; break; }
    }
  }
  let focused = null;
  try {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (el && el !== document.body && el !== document.documentElement) focused = describe(el);
  } catch (e) {}
  return { readyState: document.readyState, quietMs: performance.now() - window.__hatoQuiet.last, busy, busyReason, focused };
}`;

/** Installed on every new document so quiet time is known from the start of the page. */
export const QUIET_INSTALL = `(() => {
  if (window.__hatoQuiet) return;
  const st = window.__hatoQuiet = { last: performance.now() };
  try { new MutationObserver(() => { st.last = performance.now(); }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden", "aria-busy", "aria-hidden", "disabled", "open"] }); } catch (e) {}
})();`;

/** Per-condition wait check; every given condition is reported so a timeout says which one failed. */
export const WAIT_FN = `function(selector, text, selectorGone, textGone) {
  ${PRELUDE}
  const r = {};
  const present = sel => qa(sel).some(visible);
  const hay = () => {
    let t = (document.body && document.body.innerText) || "";
    for (const root of roots) if (root !== document && root.nodeType === 9 && root.body) t += "\\n" + (root.body.innerText || "");
    for (const el of qa("input,textarea,select")) { try { if (el.type !== "password" && el.value) t += "\\n" + el.value; } catch (e) {} }
    return norm(t).toLowerCase();
  };
  const text1 = text ? norm(text).toLowerCase() : "", text2 = textGone ? norm(textGone).toLowerCase() : "";
  const h = text1 || text2 ? hay() : "";
  if (selector) r.selector = present(selector);
  if (text) r.text = h.includes(text1);
  if (selectorGone) r.selectorGone = !present(selectorGone);
  if (textGone) r.textGone = !h.includes(text2);
  r.readyState = document.readyState;
  return r;
}`;
