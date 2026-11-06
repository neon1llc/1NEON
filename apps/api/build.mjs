// apps/api/build.mjs - Bundles each Lambda handler into dist/<name>/index.mjs for Node 22 on arm64
// (the Lambda runtime in infra/modules/api).


import { build } from "esbuild";


// One bundle per Lambda function; names match dist/ folders the deploy workflow zips
const handlers = ["api", "auth-triggers"];


// Node 22 ESM for arm64, minified, with linked source maps the deploy leaves out of the zip
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
      // ESM bundles still meet CommonJS `require` inside some dependencies; give them one
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    }),
  ),
);
// One line for the CI log
console.log(`built ${handlers.join(", ")}`);
