// Page-side helpers evaluated through Runtime.evaluate. Kept as plain function sources so they run
// in any page without injected libraries. Element refs are stamped as `data-hato-ref` attributes
// so later actions target the same node even if the page reorders.

/** Visible text: `viewport` limits to what is currently on screen. */
export const TEXT_FN = `function(scope, selector, max) {
  const root = selector ? document.querySelector(selector) : document.body;
  if (!root) return { error: "No element matches " + selector };
  const vw = innerWidth, vh = innerHeight;
  if (scope !== "viewport") {
    const t = (root.innerText || "").replace(/\\n{3,}/g, "\\n\\n").trim();
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

/** Interactive elements with refs and centers (CSS px in the viewport). */
export const ELEMENTS_FN = `function(all, max) {
  const sel = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=combobox],[role=textbox],[contenteditable=""],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"])';
  const vw = innerWidth, vh = innerHeight;
  let next = Number(document.documentElement.getAttribute("data-hato-next") || "1");
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.pointerEvents === "none") continue;
    const inView = !(r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw);
    if (!all && !inView) continue;
    let ref = el.getAttribute("data-hato-ref");
    if (!ref) { ref = String(next++); el.setAttribute("data-hato-ref", ref); }
    const tag = el.tagName.toLowerCase();
    const label = (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt") || el.getAttribute("name") || "").replace(/\\s+/g, " ").trim().slice(0, 120);
    const item = { ref: Number(ref), tag, role: el.getAttribute("role") || undefined, text: label, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), inView };
    if (tag === "input") { item.type = el.type; if (el.type === "checkbox" || el.type === "radio") item.checked = el.checked; }
    if (tag === "a") item.href = el.href;
    if (el.disabled) item.disabled = true;
    out.push(item);
    if (out.length >= max) break;
  }
  document.documentElement.setAttribute("data-hato-next", String(next));
  return { elements: out, viewport: { width: vw, height: vh }, scroll: { x: scrollX, y: scrollY } };
}`;

/** Scroll a target into view and return its center. */
export const LOCATE_FN = `function(ref, selector) {
  const el = ref ? document.querySelector('[data-hato-ref="' + ref + '"]') : document.querySelector(selector);
  if (!el) return { error: ref ? "Element ref " + ref + " is gone; list elements again" : "No element matches " + selector };
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName.toLowerCase(), editable: el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName) };
}`;

/** Select all text of an editable target so typing replaces it. */
export const CLEAR_FN = `function(ref, selector) {
  const el = ref ? document.querySelector('[data-hato-ref="' + ref + '"]') : selector ? document.querySelector(selector) : document.activeElement;
  if (!el) return false;
  el.focus();
  if (typeof el.select === "function") { el.select(); return true; }
  if (el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; }
  return false;
}`;

export const WAIT_FN = `function(selector, text) {
  if (selector) return !!document.querySelector(selector);
  if (text) return (document.body && document.body.innerText || "").includes(text);
  return document.readyState === "complete";
}`;
