# Sign-in performance on a slow phone

Measured 2026-11-09 with `scripts/perf-signin.cjs`: an emulated Pixel 7 on Slow 4G (150 ms round trip, 1.6 Mbps down, 0.75 Mbps up) with the CPU slowed 4x and the cache off, five runs each, medians shown. This is an emulation in headless Chromium, not a real handset, so treat the times as relative.

"Ready" is when the email field is on screen and takes typing. "Blocking" is main-thread time beyond 50 ms per long task.

| Build | Script bytes (transferred) | First paint | Ready | Blocking |
|---|---|---|---|---|
| Before route splitting (f96eba7^), local, uncompressed | 779 kB | 5.0 s | 5.4 s | 0.97 s |
| After route splitting, local, uncompressed | 679 kB | 4.5 s | 4.9 s | 0.91 s |
| Live at neon1.tech (compressed by CloudFront) | 213 kB | 2.2 s | 2.6 s | 1.0 s |

The local runs serve both builds the same way (no compression, API and shared files forwarded to neon1.tech), so their difference is the code split alone: about 100 kB less script and half a second sooner to type on this profile. The live row shows what visitors get with compression.

What's left is mostly React, the router, and zod, which every page needs, and about a second of main-thread work at 4x slowdown. Splitting further would trade one download for several round trips on a slow link, so nothing more is planned unless a real phone shows a problem.

Budget: the live sign-in page should stay under 250 kB of transferred script and under 3 s to ready on this profile. Run the script before and after any change that adds a dependency to the first page.
