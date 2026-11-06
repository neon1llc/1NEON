// apps/web/src/pages/Legal.tsx - Public legal pages under /1NEON: privacy, terms, and cookies.
// Readable without signing in.


import { Link } from "react-router";
import { Markdown } from "../components/Markdown.tsx";
import cookies from "../legal/cookie-notice.md?raw";
import privacy from "../legal/privacy-policy.md?raw";
import terms from "../legal/terms-of-use.md?raw";


// The source of each page lives in src/legal as Markdown, so edits stay reviewable as text
const DOCS = { privacy, terms, cookies } as const;


/** One legal document, with links to the others */
export function Legal({ doc }: { doc: keyof typeof DOCS }) {
  return (
    <main className="content legal" style={{ maxWidth: 760, margin: "0 auto" }}>
      <p className="small"><Link to="/">← 1NEON</Link></p>
      {/* Rendered from Markdown, then links to the other two documents */}
      <Markdown source={DOCS[doc]} />
      <p className="small muted" style={{ marginTop: 40 }}>
        <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link> · <Link to="/cookies">Cookies</Link>
      </p>
    </main>
  );
}
