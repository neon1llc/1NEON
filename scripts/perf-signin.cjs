// scripts/perf-signin.cjs - Sign-in page on an emulated slow phone: Pixel 7, Slow 4G (150 ms, 1.6/0.75 Mbps),
// CPU slowed 4x, cache off. Prints medians of first paint, largest paint, load, "ready" (the email field
// takes typing), main-thread blocking over 50 ms, and script bytes. Needs Playwright with Chromium.
// Usage: node scripts/perf-signin.cjs https://neon1.tech/1NEON/ 5
const { chromium, devices } = require('playwright');
const url = process.argv[2], runs = +process.argv[3] || 3;
(async () => {
  const browser = await chromium.launch();
  const out = [];
  for (let i = 0; i < runs; i++) {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    let js = 0; const reqType = new Map();
    cdp.on('Network.responseReceived', e => reqType.set(e.requestId, e.type));
    cdp.on('Network.loadingFinished', e => { if (reqType.get(e.requestId) === 'Script') js += e.encodedDataLength; });
    await page.addInitScript(() => {
      window.__lt = 0; window.__lcp = 0;
      new PerformanceObserver(l => l.getEntries().forEach(e => { window.__lt += Math.max(0, e.duration - 50); })).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver(l => l.getEntries().forEach(e => { window.__lcp = e.startTime; })).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    // Practical interactivity: the email field is visible and accepts typing
    const email = page.locator('input[type=email], input[autocomplete~=email]').first();
    await email.waitFor({ state: 'visible', timeout: 120000 });
    await email.fill('x');
    const ready = Date.now() - t0;
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => ({ fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0, lcp: window.__lcp, tbt: window.__lt, load: performance.timing.loadEventEnd - performance.timing.navigationStart,
      scripts: performance.getEntriesByType('resource').filter(r => r.initiatorType === 'script' || r.name.endsWith('.js')).map(r => r.decodedBodySize).reduce((a, b) => a + b, 0) }));
    out.push({ ...m, ready, jsTransferred: js });
    await ctx.close();
  }
  await browser.close();
  const med = k => { const v = out.map(o => o[k]).sort((a, b) => a - b); return Math.round(v[Math.floor(v.length / 2)]); };
  console.log(JSON.stringify({ url, runs, median: Object.fromEntries(['fcp', 'lcp', 'load', 'ready', 'tbt', 'jsTransferred', 'scripts'].map(k => [k, med(k)])) }));
})().catch(e => { console.error(e.message); process.exit(1); });
