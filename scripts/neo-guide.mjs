// scripts/neo-guide.mjs - Refresh what Neo knows about 1NEON: the portal bundle of neon1-corpus (the
// 1NEON guide, the 1NEON FAQ, the process, names, and contact), exported at one pinned ref and
// written to apps/api/src/neo/guide.json, which the API bundles. Run it after the guide changes:
//
//   node scripts/neo-guide.mjs v0.24.0      # a tag, a branch, or a commit of neon1-corpus
//
// All or nothing: the file is written only after every document checks out against its digest.


import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";


const ref = process.argv[2];
if (!ref) {
  console.error("Name a neon1-corpus ref: node scripts/neo-guide.mjs v0.24.0");
  process.exit(1);
}
const REPO = "https://github.com/neon1llc/neon1-corpus";
const out = join(dirname(fileURLToPath(import.meta.url)), "../apps/api/src/neo/guide.json");

// A shallow copy of the corpus at that ref, exported with its own tools (Node, no dependencies)
const dir = mkdtempSync(join(tmpdir(), "corpus-"));
try {
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("fetch", "-q", "--depth", "1", REPO, ref);
  git("checkout", "-q", "FETCH_HEAD");
  const commit = git("rev-parse", "HEAD");
  execFileSync("node", ["tools/export.mjs", "--target", "portal"], { cwd: dir, stdio: "ignore" });
  const bundle = JSON.parse(readFileSync(join(dir, "dist/portal/bundle.json"), "utf8"));

  // Every document must match its digest, and the guide itself must be there
  const docs = bundle.files.map((f) => {
    const sum = createHash("sha256").update(f.text).digest("hex");
    if (sum !== f.sha256) throw new Error(`${f.id}: digest mismatch`);
    return { id: f.id, title: f.title, text: f.text };
  });
  for (const need of ["1neon-guide-overview", "1neon-guide-projects", "1neon-guide-pages", "1neon-guide-account"]) {
    if (!docs.some((d) => d.id === need)) throw new Error(`missing ${need}`);
  }
  const chars = docs.reduce((n, d) => n + d.text.length, 0);
  // About 4 characters a token: past 120,000 characters the prompt would cost more than planned
  if (chars > 120_000) throw new Error(`the guide is ${chars} characters, over the 120,000 bound`);

  writeFileSync(out, `${JSON.stringify({ ref, commit, digest: bundle.digest, chars, docs }, null, 1)}\n`);
  console.log(`neo guide: ${docs.length} documents, ${chars} characters, neon1-corpus ${ref} (${commit.slice(0, 7)})`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
