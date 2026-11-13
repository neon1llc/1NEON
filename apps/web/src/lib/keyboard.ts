// apps/web/src/lib/keyboard.ts - What someone types stays in view above a phone's keyboard.
//
// When a box gets focus, and again each time the person types, the box (or, in a tall box, the line
// being typed on) is scrolled into the space between the top of the screen (below the app's own top
// bar and any browser bar over it) and the top of the keyboard. Only typing and the keyboard opening
// or resizing do this: scrolling away to read something leaves the page where the person put it, and
// the next keystroke brings the line back. The visible area is also kept as two CSS variables, --vvt
// and --vvh (top and height of what's on screen), so a dialog can sit in it as a box above the
// keyboard (styles/app.css, "Above the keyboard").


// Boxes people type into: text inputs of every kind, text areas, and editable regions
const TYPED = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="color"]), textarea, [contenteditable="true"]';
// Space kept between the line being typed and the keyboard, or the top edge
const GAP = 14;

/** Where the line being typed sits in a text area, in viewport pixels (a hidden copy of the box's text
 * up to the caret is measured, wrapped exactly as the box wraps it) */
function caretBand(ta: HTMLTextAreaElement): { top: number; bottom: number } {
  const cs = getComputedStyle(ta);
  const copy = document.createElement("div");
  for (const p of ["boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "wordSpacing", "textIndent", "textTransform", "tabSize"] as const) copy.style[p] = cs[p];
  Object.assign(copy.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px", whiteSpace: "pre-wrap", overflowWrap: "break-word", height: "auto" });
  copy.textContent = ta.value.slice(0, ta.selectionEnd ?? ta.value.length);
  const mark = document.createElement("span");
  mark.textContent = "​";
  copy.append(mark);
  document.body.append(copy);
  const y = mark.offsetTop - ta.scrollTop;
  const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
  copy.remove();
  const r = ta.getBoundingClientRect();
  const top = r.top + Math.max(0, Math.min(y, ta.clientHeight - line));
  return { top, bottom: top + line };
}

/** The nearest box around an element that scrolls up and down */
function scrollerOf(el: Element): Element | undefined {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return undefined;
}

/** The part of the screen a typed line can be seen in: the visible viewport, less the app's top bar
 * (on a page, not in a dialog) and a browser bar drawn over the page */
function window_(el: Element): { top: number; bottom: number } {
  const vv = window.visualViewport;
  const top0 = vv ? vv.offsetTop : 0;
  const height = vv ? vv.height : innerHeight;
  let top = top0 + GAP;
  const inDialog = Boolean(el.closest("dialog"));
  if (!inDialog) {
    const bar = document.querySelector(".top");
    if (bar) top = Math.max(top, bar.getBoundingClientRect().bottom + GAP);
  }
  // Browsers that draw their own bar over the page's top (DuckDuckGo on iPhone) leave less room
  top += parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--chrome-top")) || 0;
  // With the keyboard down, the tab bar covers the bottom of a page
  let bottom = top0 + height - GAP;
  const keyboard = vv ? vv.height < innerHeight * 0.8 : false;
  if (!keyboard && !inDialog) {
    const tabs = document.querySelector(".tabbar");
    if (tabs && getComputedStyle(tabs).display !== "none") bottom = Math.min(bottom, tabs.getBoundingClientRect().top - GAP);
  }
  return { top, bottom };
}

/** Scroll whatever holds `el` so the box, or the line being typed in a tall one, is in view */
export function bringIntoView(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  if (!r.height) return;
  const view = window_(el);
  const room = view.bottom - view.top;
  // The whole box when it fits; otherwise the line with the caret
  const band = r.height <= room ? { top: r.top, bottom: r.bottom } : el instanceof HTMLTextAreaElement ? caretBand(el) : { top: r.top, bottom: Math.min(r.bottom, r.top + room) };
  let delta = band.bottom > view.bottom ? band.bottom - view.bottom : band.top < view.top ? band.top - view.top : 0;
  if (Math.abs(delta) < 2) return;
  // Each scrolling box around it takes what it can, then the page takes the rest
  for (let box = scrollerOf(el); box && Math.abs(delta) >= 1; box = scrollerOf(box)) {
    const before = box.scrollTop;
    box.scrollTop = before + delta;
    delta -= box.scrollTop - before;
  }
  if (Math.abs(delta) >= 1) {
    const root = document.documentElement.classList.contains("body-scrolls") ? document.body : document.scrollingElement;
    if (root) root.scrollTop += delta;
  }
}

/** Start keeping typed text in view, and the visible area in --vvt and --vvh. Phones and tablets only */
export function keepTypingInView() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const coarse = matchMedia("(pointer: coarse)").matches;
  const measure = () => {
    root.style.setProperty("--vvt", `${vv ? vv.offsetTop : 0}px`);
    root.style.setProperty("--vvh", `${vv ? vv.height : innerHeight}px`);
    // The keyboard is up: a box being typed in, and much less screen showing than the page has
    const typing = Boolean(document.activeElement?.matches?.(TYPED));
    root.classList.toggle("kb-open", coarse && typing && Boolean(vv) && vv!.height < Math.max(innerHeight, root.clientHeight) * 0.8);
  };
  measure();
  vv?.addEventListener("resize", measure);
  vv?.addEventListener("scroll", measure);
  if (!coarse) return;
  let active: HTMLElement | undefined;
  let timer = 0;
  const soon = (ms: number) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => { if (active && document.activeElement === active) bringIntoView(active); }, ms);
  };
  // Focus: after the keyboard has had time to rise
  document.addEventListener("focusin", (e) => {
    const t = e.target as HTMLElement;
    if (!t.matches?.(TYPED)) return;
    active = t;
    measure();
    soon(320);
  });
  document.addEventListener("focusout", () => { active = undefined; setTimeout(measure, 0); });
  // Typing: at once, so a new line that wraps below the keyboard comes up as it's typed
  document.addEventListener("input", (e) => { if (e.target === active) soon(0); });
  // The keyboard rising, falling, or changing height (a suggestion bar), but not the person scrolling
  vv?.addEventListener("resize", () => { if (active) soon(60); });
}
