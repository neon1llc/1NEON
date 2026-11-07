// apps/web/src/pages/Faqs.tsx - Public FAQs at /1NEON/faqs: questions grouped by topic, each opening
// in place, with a search box. The text lives in src/help/faqs.md.


import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Markdown } from "../components/Markdown.tsx";
import source from "../help/faqs.md?raw";


// One topic and its questions, parsed from "## Topic" and "### Question" headings
interface Topic {
  name: string;
  items: { q: string; a: string }[];
}


/** Split the Markdown into its intro and topics */
function parse(md: string) {
  const [head = "", ...rest] = md.split(/^## /m);
  const intro = head.replace(/^# .*$/m, "").trim();
  const topics: Topic[] = rest.map((block) => {
    const [name = "", ...qs] = block.split(/^### /m);
    return {
      name: name.trim(),
      items: qs.map((q) => {
        const [title = "", ...body] = q.split("\n");
        return { q: title.trim(), a: body.join("\n").trim() };
      }),
    };
  });
  return { intro, topics };
}


const FAQ = parse(source);


/** The FAQs page, readable without signing in */
export function Faqs() {
  const [q, setQ] = useState("");
  // Matching questions only, while something is typed
  const topics = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return FAQ.topics;
    return FAQ.topics.map((x) => ({ ...x, items: x.items.filter((i) => (i.q + i.a).toLowerCase().includes(t)) })).filter((x) => x.items.length);
  }, [q]);
  return (
    <main className="content legal faqs" style={{ maxWidth: 760, margin: "0 auto" }}>
      <p className="small"><Link to="/">← 1NEON</Link></p>
      <h1 className="page-title">FAQs</h1>
      <Markdown source={FAQ.intro} />
      <input type="search" aria-label="Search the FAQs" placeholder="Search the FAQs" value={q} onChange={(e) => setQ(e.target.value)} className="faq-search" />
      {topics.length === 0 && <p className="muted">No answers match. Email hello@neon1.tech and I'll help.</p>}
      {topics.map((t) => (
        <section key={t.name}>
          <h2 className="section-h">{t.name}</h2>
          {t.items.map((i) => (
            <details key={i.q} className="faq" open={Boolean(q.trim())}>
              <summary>{i.q}</summary>
              <Markdown source={i.a} />
            </details>
          ))}
        </section>
      ))}
      <p className="small muted" style={{ marginTop: 40 }}>
        <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link> · <Link to="/cookies">Cookies</Link> · <Link to="/faqs">FAQs</Link>
      </p>
    </main>
  );
}
