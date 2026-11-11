// apps/web/src/pages/Faqs.tsx - Public FAQs at /1NEON/faqs: questions grouped by topic, each opening
// in place with its own link, and a search box that knows everyday words. The text lives in
// src/help/faqs.md; parsing, anchors, and search are in lib/faq.ts.


import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { Markdown } from "../components/Markdown.tsx";
import source from "../help/faqs.md?raw";
import { matches, parse, type Question } from "../lib/faq.ts";


const FAQ = parse(source);


/** Copy a question's address, so one answer can be sent on its own */
function CopyLink({ item }: { item: Question }) {
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/1NEON/faqs#${item.id}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard (an older browser, or permission refused): the link itself still works
      location.hash = item.id;
    }
  };
  return (
    <p className="faq-link small">
      <a href={`#${item.id}`} onClick={(e) => { e.preventDefault(); void copy(); }} aria-label={`Copy a link to "${item.q}"`}>Copy link</a>
      <span role="status" className="muted">{copied ? " Copied." : ""}</span>
    </p>
  );
}


/** The FAQs page, readable without signing in */
export function Faqs() {
  const [q, setQ] = useState("");
  // The question a link points at (#id) opens on arrival and scrolls into view
  const { hash } = useLocation();
  const target = decodeURIComponent(hash.replace(/^#/, ""));
  useEffect(() => {
    if (target) document.getElementById(target)?.scrollIntoView({ block: "start" });
  }, [target]);
  // Matching questions only, while something is typed
  const topics = useMemo(() => {
    if (!q.trim()) return FAQ.topics;
    return FAQ.topics.map((x) => ({ ...x, items: x.items.filter((i) => matches(i, q)) })).filter((x) => x.items.length);
  }, [q]);
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (!q.trim()) { setSaid(""); return; }
    const n = topics.reduce((a, t) => a + t.items.length, 0);
    const t = window.setTimeout(() => setSaid(n ? `${n} ${n === 1 ? "answer" : "answers"} match` : "No answers match"), 500);
    return () => window.clearTimeout(t);
  }, [q, topics]);
  return (
    <main className="content legal faqs" style={{ maxWidth: 760, margin: "0 auto" }}>
      <p className="small"><Link to="/">← 1NEON</Link></p>
      <h1 className="page-title">FAQs</h1>
      <Markdown source={FAQ.intro} />
      <input type="search" aria-label="Search the FAQs" placeholder="Search the FAQs" value={q} onChange={(e) => setQ(e.target.value)} className="faq-search" />
      {/* One quiet count after typing settles; focus stays in the box (AP-08) */}
      <p className="sr" role="status">{said}</p>
      {topics.length === 0 && <p className="muted">No answers match. Email <a href="mailto:hello@neon1.tech">hello@neon1.tech</a> and I'll help.</p>}
      {topics.map((t) => (
        <section key={t.name}>
          <h2 className="section-h">{t.name}</h2>
          {t.items.map((i) => (
            <details key={i.id} id={i.id} className="faq" open={Boolean(q.trim()) || i.id === target}>
              <summary>{i.q}</summary>
              <Markdown source={i.a} />
              <CopyLink item={i} />
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
