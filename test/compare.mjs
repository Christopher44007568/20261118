// 无头浏览器中运行 WASM 软件光栅器 vs WebGL2 对照实验，
// 输出报告 JSON 与截图到 ../artifacts/。
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const artifacts = join(here, "..", "artifacts");
mkdirSync(artifacts, { recursive: true });

const browser = await chromium.launch({
  args: [
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-gpu-sandbox",
    "--no-sandbox",
  ],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
page.on("console", (m) => console.log("[console]", m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.goto("http://127.0.0.1:8931/index.html");
await page.waitForFunction(() => window.__DONE === true, null, { timeout: 300_000 });

const err = await page.evaluate(() => window.__ERROR || null);
if (err) {
  console.error("页面执行出错:", err);
  process.exitCode = 1;
} else {
  const results = await page.evaluate(() => window.__RESULTS);
  writeFileSync(join(artifacts, "report.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));

  for (const [id, name] of [
    ["wasmColor", "wasm_color"],
    ["glCanvas", "webgl_color"],
    ["wasmDepth", "wasm_depth"],
    ["glDepth", "webgl_depth"],
    ["diff", "color_diff_x8"],
  ]) {
    await page.locator("#" + id).screenshot({ path: join(artifacts, name + ".png") });
  }
  const status = await page.locator("#status").textContent();
  writeFileSync(join(artifacts, "status.txt"), status);
  console.log("\n" + status);
  if (!results.pass) process.exitCode = 1;
}
await browser.close();
