import { chromium } from "@playwright/test";
import fs from "node:fs/promises";

const candidates = [
  process.env.CHROME_PATH,
  chromium.executablePath(),
  "/home/hj/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",
].filter(Boolean);
let executablePath;
for (const candidate of candidates) {
  try {
    await fs.access(candidate);
    executablePath = candidate;
    break;
  } catch {
    // Try the next local browser.
  }
}
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:5177/";

await fs.mkdir("artifacts/final", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
  args: [
    "--no-sandbox",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-angle=swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const messages = [];
page.on("console", (message) => messages.push(`${message.type()}: ${message.text()}`));
page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`));
await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__shadowDemo), null, { timeout: 15000 });
await page.evaluate(() => window.__shadowDemo.verifyNow());
await page.screenshot({ path: "artifacts/final/scene-1.png" });
const scenarios = [
  ["scene-2", 1, null, null],
  ["scene-3", 2, null, null],
  ["scene-4-invalid", 3, null, null],
  ["debug-volume", 0, { showVolume: true, showSilhouette: true }, null],
  ["debug-stencil", 0, { showStencil: true }, null],
  ["inside-volume", 0, null, "inside"],
  ["near-plane", 0, null, "near"],
];
const results = [];
for (const [name, scene, debug, preset] of scenarios) {
  const state = await page.evaluate(
    ({ scene, debug, preset }) => {
      window.__shadowDemo.selectScene(scene);
      if (debug) {
        window.__shadowDemo.setDebug("showVolume", Boolean(debug.showVolume));
        window.__shadowDemo.setDebug("showSilhouette", Boolean(debug.showSilhouette));
        window.__shadowDemo.setDebug("showStencil", Boolean(debug.showStencil));
      } else {
        window.__shadowDemo.setDebug("showVolume", false);
        window.__shadowDemo.setDebug("showSilhouette", false);
        window.__shadowDemo.setDebug("showStencil", false);
      }
      if (preset) window.__shadowDemo.setPreset(preset);
      window.__shadowDemo.verifyNow();
      return window.__shadowDemo.getState();
    },
    { scene, debug, preset },
  );
  await page.waitForTimeout(80);
  await page.screenshot({ path: `artifacts/final/${name}.png` });
  results.push({ name, state });
}
for (const { name, state } of results) {
  if (!state.webgl2) throw new Error(`${name}: WebGL2 unavailable`);
  if (!state.verification || state.verification.mismatchRate > 0.01) {
    throw new Error(`${name}: CPU/GPU mismatch rate exceeded 1%`);
  }
}
const byName = new Map(results.map((entry) => [entry.name, entry.state]));
if ((byName.get("scene-3")?.verification?.gpuShadowed ?? 0) < 100) {
  throw new Error("scene-3: intersecting shadow coverage was not exercised");
}
if ((byName.get("scene-4-invalid")?.metrics.validMeshes ?? 1) !== 0) {
  throw new Error("scene-4: invalid meshes were not rejected");
}
if ((byName.get("scene-4-invalid")?.metrics.violations ?? 0) < 1) {
  throw new Error("scene-4: topology violations were not reported");
}
if ((byName.get("inside-volume")?.verification?.gpuShadowed ?? 0) < 500) {
  throw new Error("inside-volume: shadow volume coverage was not exercised");
}
if ((byName.get("near-plane")?.verification?.gpuShadowed ?? 0) < 1) {
  throw new Error("near-plane: no shadowed samples found");
}
console.log(JSON.stringify({ results, messages }, null, 2));
console.error("Browser verification passed.");
await browser.close();
