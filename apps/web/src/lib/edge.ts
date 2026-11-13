// apps/web/src/lib/edge.ts - The top and bottom edges of the screen in iPhone browsers, and the one
// place that knows which element scrolls the page.
//
// DuckDuckGo on iPhone draws the page all the way down, under its floating toolbar, but stops
// everything fixed (the tab bar, the menu, a walkthrough's backdrop) at the toolbar's top edge and
// clips whatever runs past it. So the page scrolled by in that strip, in view, under the tab bar.
// Nothing fixed can cover it. What can: the page itself doesn't scroll there. The body scrolls
// inside a page that stays still, and the strip under the toolbar shows the page's own background,
// which matches the tab bar. The same goes for the top: the body is pinned to the part of the screen
// between the browser's own bars, so nothing scrolls by under a see-through bar at either end.
//
// DuckDuckGo often sends Safari's own user agent, so it can't be told apart from Safari. Every iPhone
// browser gets this, then (they all run on Safari's engine, and Safari's own glass toolbar shows the
// page through it too). Elsewhere the page scrolls as usual.


// Any browser on an iPhone or iPod, and an iPad, which says it's a Mac but has a touch screen
const IPHONE = /iPhone|iPod|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** Set once at startup, before the first paint: the body scrolls instead of the page on an iPhone
 * (styles/app.css, "Under the browser's own controls") */
export function keepEdgeStill() {
  if (IPHONE) document.documentElement.classList.add("body-scrolls");
}

/** What scrolls the page: the body where it scrolls on its own, the window everywhere else */
export function pageScroller(): Pick<Window, "scrollTo" | "scrollBy"> {
  return document.documentElement.classList.contains("body-scrolls") ? document.body : window;
}
