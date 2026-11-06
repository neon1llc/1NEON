// Bundles each Lambda handler into dist/<name>/index.mjs (Node 24, arm64).
import { build } from "esbuild";

const handlers = ["api", "auth-triggers"];

await Promise.all(
  handlers.map((name) =>
    build({
      entryPoints: [`src/handlers/${name}.ts`],
      outfile: `dist/${name}/index.mjs`,
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      minify: true,
      sourcemap: "linked",
      legalComments: "none",
      // Bundle the AWS SDK too: the runtime's copy lags and lacks the presign helpers.
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    }),
  ),
);
console.log(`built ${handlers.join(", ")}`);
