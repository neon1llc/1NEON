// apps/web/src/pages/NotFound.tsx - Fallback for unknown URLs under /1NEON.


import { Link } from "react-router";


// Inside Root, so only signed-in people reach it
export function NotFound() {
  return (
    <main className="content">
      <h1 className="page-title">Not found</h1>
      <p className="lead">That page doesn't exist in 1NEON.</p>
      <Link className="btn btn-ghost" to="/">Go to my workspace</Link>
    </main>
  );
}
