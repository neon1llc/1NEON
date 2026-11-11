// apps/web/src/lib/zod-config.ts - Zod set up for the browser, imported first by main.tsx.


import { config } from "zod";


// The portal's CSP has no 'unsafe-eval', so Zod's speed-up that compiles parsers with new Function
// would be refused (Firefox and Safari log each refusal as an error). Jitless parses the same way
// without trying
config({ jitless: true });
