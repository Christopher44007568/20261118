import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const root = resolve(new URL("..", import.meta.url).pathname);
const port = 4182;
const chromePath = process.env.CHROME_PATH || "/tmp/chrome-full/chrome-linux64/chrome";
const server = spawn(process.execPath, ["scripts/server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: "ignore",
});

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("capture server did not start");
}

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function savePreview(page, name) {
  const dataUrl = await page.locator("#texturePreview").evaluate((canvas) => canvas.toDataURL("image/png"));
  await writeFile(join(root, "artifacts", name), Buffer.from(dataUrl.split(",")[1], "base64"));
}

try {
  await mkdir(join(root, "artifacts"), { recursive: true });
  await waitForServer();
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on("pageerror", (error) => console.error("page error:", error.message));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  try {
    await page.waitForFunction(
      () => document.querySelector("#statusText")?.textContent.includes("双场景烘焙完成"),
      null,
      { timeout: 30000 },
    );
  } catch (error) {
    console.error("status:", await page.locator("#statusText").textContent());
    throw error;
  }

  await page.locator('[data-scenario="hard"]').click();
  await page.locator('#previewModeControl [data-value="normal"]').click();
  await page.waitForTimeout(250);
  await savePreview(page, "bake_hard_cage.png");
  await page.screenshot({ path: join(root, "artifacts", "workspace_hard_cage.png") });

  await page.locator('[data-scenario="rounded"]').click();
  await page.locator('#projectionControl [data-value="cage"]').click();
  await setRange(page, "#rayDistance", 0.4);
  await page.waitForTimeout(900);
  await savePreview(page, "bake_cage.png");

  await page.locator('#projectionControl [data-value="nearest"]').click();
  await page.waitForTimeout(1000);
  await savePreview(page, "bake_nearest.png");
  await page.screenshot({ path: join(root, "artifacts", "workspace_rounded_nearest.png") });

  await page.locator('#projectionControl [data-value="cage"]').click();
  await setRange(page, "#rayDistance", 0.1);
  await page.locator('#previewModeControl [data-value="mask"]').click();
  await page.waitForTimeout(900);
  await savePreview(page, "bake_short_ray_mask.png");
  await page.screenshot({ path: join(root, "artifacts", "workspace_short_ray_mask.png") });

  await browser.close();
  console.log("Captured bake maps and workspace screenshots in artifacts/.");
} finally {
  server.kill();
}
