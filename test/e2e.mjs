import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const CHROME = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGE_URL =
  process.env.PAGE_URL ||
  "file://" + execSync("wslpath -w " + ROOT + "index.html").toString().trim().replace(/\\/g, "/");
const OUT = fileURLToPath(new URL("../test-out/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--no-proxy-server",
    "--proxy-server=direct://",
    "--allow-file-access-from-files",
    "--disable-gpu-sandbox",
    "--no-sandbox",
    "--window-size=1280,900",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} - ${name} ${detail}`);
}

try {
  await page.goto(PAGE_URL, { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(2500);

  const gpu = await page.$eval("#gpu-badge", (el) => el.textContent);
  check("WebGPU 初始化", !gpu.includes("不可用") && !gpu.includes("初始化"), gpu);

  const hasWebGPU = await page.evaluate(() => !!navigator.gpu);
  check("navigator.gpu 存在", hasWebGPU);

  // Determinism: reset twice and compare the first-frame accumulator.
  const readAccumPixel = async () =>
    page.evaluate(async () => {
      const s = window.__state;
      const device = s.device;
      const staging = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(s.frameRes.accum, 0, staging, 0, 16);
      device.queue.submit([enc.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const arr = Array.from(new Float32Array(staging.getMappedRange().slice(0)));
      staging.unmap();
      staging.destroy();
      return arr;
    });

  await page.evaluate(() => {
    document.getElementById("target-spp").value = "1";
    document.getElementById("target-spp").dispatchEvent(new Event("change"));
  });
  await page.evaluate(() => window.requestReset());
  await sleep(300);
  const runA = await readAccumPixel();
  await page.evaluate(() => window.requestReset({ clearSnapshots: false }));
  await sleep(300);
  const runB = await readAccumPixel();
  const deterministic =
    runA.length === runB.length && runA.every((v, i) => Math.abs(v - runB[i]) < 1e-6);
  check("重置后随机流可复现", deterministic, `n=${runA[3]}`);

  // Restore a generous target for the remaining tests.
  await page.evaluate(() => {
    document.getElementById("target-spp").value = "100000";
    document.getElementById("target-spp").dispatchEvent(new Event("change"));
  });

  // Pause / resume sample-counter test through the GPU readback helper.
  const gpuSpp = async () =>
    page.evaluate(async () => {
      const g = await window.readGpuSpp();
      return g;
    });

  // Click pause, read count, wait, confirm frozen, resume, confirm growth.
  await page.click("#btn-pause");
  await page.waitForFunction(
    () => document.getElementById("btn-pause").textContent === "继续",
    { timeout: 5000 }
  );
  await sleep(200);
  const before = await gpuSpp();
  await sleep(400);
  const frozen = await gpuSpp();
  check("暂停后样本数冻结", before.max === frozen.max, `before=${before.max} frozen=${frozen.max}`);

  await page.click("#btn-pause");
  await page.waitForFunction(
    () => document.getElementById("btn-pause").textContent === "暂停",
    { timeout: 5000 }
  );
  await sleep(700);
  const after = await gpuSpp();
  check("继续后样本数增长", after.max > before.max, `before=${before.max} after=${after.max}`);

  // Fresh run: capture convergence images at exact SPP thresholds.
  await page.evaluate(() => {
    document.getElementById("target-spp").value = "1000";
    document.getElementById("target-spp").dispatchEvent(new Event("change"));
    window.requestReset();
  });
  for (const spp of [10, 100, 1000]) {
    const reached = await page.evaluate((at) => window.waitForFrame(at), spp);
    await page.evaluate(() => window.__state.device.queue.onSubmittedWorkDone());
    await sleep(80);
    await page.screenshot({ path: `${OUT}frame-${spp}spp.png` });
    if (spp < 1000) await page.evaluate(() => { window.__state.paused = false; });
    check(`精确累积到 ${spp} SPP`, reached === spp, `frame=${reached}`);
  }

  // Snapshot tiles populated.
  const tiles = await page.$$eval(".snap img", (imgs) => imgs.length);
  check("自动生成收敛截图", tiles >= 3, `tiles=${tiles}`);

  // Determinism via in-page self-test.
  await page.click("#btn-selftest");
  await sleep(2500);
  const selfLog = await page.$eval("#selftest-log", (el) => el.textContent);
  check("自检通过(可复现/暂停继续)", !selfLog.includes("FAIL"), selfLog.replace(/\s+/g, " ").slice(0, 300));

  await page.screenshot({ path: `${OUT}full-page.png`, fullPage: true });
} catch (err) {
  check("测试流程异常", false, err.message);
  console.error(err);
}

const errors = logs.filter((l) => l.includes("[error]") || l.includes("pageerror"));
check("无 WebGPU/JS 运行时错误", errors.length === 0, errors.join(" | ").slice(0, 400));
writeFileSync(`${OUT}console.log`, logs.join("\n"));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
