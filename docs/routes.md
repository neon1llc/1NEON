# Route intent map

What each route under neon1.tech/1NEON is for, and what it asks of search engines. `apps/web/src/lib/head.ts` applies this map (title, description, robots, canonical) on every navigation, and `head.test.ts` checks it route by route. Indexing tags are a search hint only: authentication in the API is what keeps account data private.

| Route | Who it's for | Indexing | Canonical |
|---|---|---|---|
| `/1NEON/` (sign-in) | Invited clients signing in | `noindex` | none |
| `/1NEON/o/...`, `/1NEON/all/...`, `/1NEON/me` | Signed-in clients and neon1 | `noindex` | none |
| `/1NEON/demo/...` | Prospects trying the interactive demo (in-browser, temporary) | `noindex` | none |
| `/1NEON/live...` | Prospects watching the guided walkthrough (fictional, resets on load) | `noindex` | none |
| `/1NEON/example` | Anyone: a sample project to read | indexable | `https://neon1.tech/1NEON/example` |
| `/1NEON/faqs` | Anyone: portal help | indexable | `https://neon1.tech/knowledge/faq/1neon-help/` (the same answers, published from neon1-corpus) |
| `/1NEON/privacy`, `/terms`, `/cookies` | Anyone: policies | indexable | none set (see below) |
| `/1NEON/faq`, `/1NEON/help` | Old addresses | redirect to `/1NEON/faqs` in the app | |

Notes:

- `noindex` pages stay crawlable (nothing in robots.txt blocks them), so a crawler can see the tag.
- Nothing points at the site's home page as a catch-all canonical.
- The tags are set from code after the app loads, so search engines that render JavaScript see them. Every route still serves the same `index.html`, whose raw HTML carries only the generic title and description. Putting route-specific tags into the raw HTML needs a pre-rendered page or an edge rewrite for `/1NEON/example` and `/1NEON/faqs`, which belongs with the hosting setup in neon1-site.
- Keep the FAQ copy in `apps/web/src/help/faqs.md` and `neon1-corpus/corpus/faq/1neon-help.md` word for word (links aside), since the portal page names the knowledge page as canonical. Anchors use the same rule in both places (`lib/faq.ts` `slug`).
- The policy pages may also have knowledge-center copies. If they're the same text, they could name those as canonical too; that's an open decision.
- No inline scripts are added for any of this, so the content security policy is unchanged.
