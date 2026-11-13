// apps/web/src/lib/edge.ts - The bottom edge of the screen in DuckDuckGo on iPhone, and the one place
// that knows which element scrolls the page.
//
// DuckDuckGo on iPhone draws the page all the way down, under its floating toolbar, but stops
// everything fixed (the tab bar, the menu, a walkthrough's backdrop) at the toolbar's top edge and
// clips whatever runs past it. So the page scrolled by in that strip, in view, under the tab bar.
// Nothing fixed can cover it. What can: the page itself doesn't scroll there. The body scrolls
// inside a page that stays still, and the strip under the toolbar shows the page's own background,
// which matches the tab bar. Only there: elsewhere the page scrolls as usual, so a phone's own
// browser can still tuck its toolbar away and scroll to the top from the status bar.


// DuckDuckGo names itself in its user agent ("DuckDuckGo/7") on iPhone
const DDG_IPHONE = /iPhone|iPod/.test(navigator.userAgent) && /\bDuckDuckGo\/\d/.test(navigator.userAgent);

/** Set once at startup, before the first paint: the body scrolls instead of the page in DuckDuckGo
 * on iPhone (styles/app.css, "Under the browser's own controls") */
export function keepEdgeStill() {
  if (DDG_IPHONE) document.documentElement.classList.add("body-scrolls");
}

/** What scrolls the page: the body where it scrolls on its own, the window everywhere else */
export function pageScroller(): Pick<Window, "scrollTo" | "scrollBy"> {
  return document.documentElement.classList.contains("body-scrolls") ? document.body : window;
}
