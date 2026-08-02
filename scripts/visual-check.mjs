// Visual verification harness for voice-nav.html route drawing (B-2b).
// Drives the app via the ?dbg=1 injection hooks (no speech recognition), mocks
// geolocation to Urayasu, injects route changes, waits for [MulmoNavi DRAW]
// logs, and captures screenshots + the DRAW JSON for each scenario.
//
//   node scripts/visual-check.mjs
//
// Requires `yarn dev` running (default http://localhost:5173). Output → /tmp/nav-visual/.

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.NAV_BASE || "http://localhost:5173";
const URL = `${BASE}/artifacts/html/2026/07/voice-nav.html?dbg=1`;
const OUT = "/tmp/nav-visual";
// Urayasu, Chiba (near Tokyo Disney) — a realistic origin with highway options to Shinjuku/Tokyo.
const GEO = { latitude: 35.6512, longitude: 139.9067 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 900, height: 1300 },
    geolocation: GEO,
    permissions: ["geolocation"],
    locale: "ja-JP",
  });
  const page = await context.newPage();

  const drawLogs = [];
  const allLogs = [];
  page.on("console", async (msg) => {
    const text = msg.text();
    allLogs.push(text);
    if (text.startsWith("[MulmoNavi DRAW]")) {
      try { drawLogs.push(await msg.args()[1].jsonValue()); }
      catch { drawLogs.push({ raw: text }); }
    }
  });
  page.on("pageerror", (e) => allLogs.push("PAGEERROR: " + e.message));

  console.log("→ opening", URL);
  await page.goto(URL, { waitUntil: "load", timeout: 60000 });

  // Wait for the dbg hooks + map + geolocation fix.
  await page.waitForFunction(() => typeof window.__navReady === "function", { timeout: 30000 });
  await page.waitForFunction(() => window.__navReady().mapReady, { timeout: 30000 }).catch(() => {});
  const gotMe = await page.waitForFunction(() => window.__navReady().me, { timeout: 20000 }).then(() => true).catch(() => false);
  console.log("  hooks ready. geolocation fix:", gotMe, "state:", await page.evaluate(() => window.__navReady()));
  await sleep(3500); // let base map tiles paint

  async function waitNewDraw(prevLen, label, ms = 25000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (drawLogs.length > prevLen) return drawLogs[drawLogs.length - 1];
      await sleep(200);
    }
    console.log(`  ! ${label}: no new [DRAW] within ${ms}ms`);
    return null;
  }
  async function shot(name) {
    const p = `${OUT}/${name}.png`;
    await page.screenshot({ path: p });
    return p;
  }

  const results = [];
  const scenarios = [
    { name: "shot1-shinjuku", label: "「新宿駅まで」", inject: () => window.__injectIntent({ destination: "新宿駅" }) },
    { name: "shot2-local", label: "「下道で」", inject: () => window.__injectIntent({ prefer: { avoidHighways: true } }) },
    { name: "shot3-tokyo", label: "「東京駅に変更」", inject: () => window.__injectIntent({ destination: "東京駅" }) },
  ];

  for (const sc of scenarios) {
    const prev = drawLogs.length;
    console.log(`→ inject ${sc.label}`);
    await page.evaluate(sc.inject);
    const draw = await waitNewDraw(prev, sc.label);
    await sleep(2500); // let the new polylines/tiles settle before capture
    const path = await shot(sc.name);
    const state = await page.evaluate(() => window.__navReady());
    console.log(`  [DRAW] ${sc.label}:`, JSON.stringify(draw), "→", path);
    results.push({ scenario: sc.label, screenshot: path, draw, state });
  }

  await writeFile(`${OUT}/results.json`, JSON.stringify({ url: URL, geo: GEO, results, drawLogs }, null, 2));
  await writeFile(`${OUT}/console.log`, allLogs.join("\n"));
  console.log("\n✓ saved:", `${OUT}/results.json`, "+ 3 screenshots + console.log");
  await browser.close();
}

main().catch((e) => { console.error("harness failed:", e); process.exit(1); });
