/* 浏览器端到端：GPU 可用走真实 WebGL，否则自动回退 CPU 模拟，验证 9 组表格。 */
const path = require("path");
const puppeteer = require("puppeteer");

const URL = "file://" + path.resolve(__dirname, "..", "index.html");
const fs = require("fs");

async function saveFrame(page, backend, tag) {
  const fileName = `screenshot-${backend === "GPU" ? "gpu" : "cpu"}-${tag}.png`;
  const outPath = path.resolve(__dirname, "..", "artifacts", fileName);
  if (backend !== "GPU") {
    // CPU 后端：直接从 2D canvas 导出，避免元素截图捕获到旧合成层
    const dataUrl = await page.evaluate(() => {
      return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() =>
          resolve(window.__renderer.canvas.toDataURL("image/png"))));
      });
    });
    fs.writeFileSync(outPath, Buffer.from(dataUrl.split(",")[1], "base64"));
  } else {
    await page.screenshot({ path: outPath });
  }
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() =>
      document.querySelectorAll("#liveStats dd").length >= 9,
    { timeout: 15000 });

    const backend = await page.evaluate(() => window.__backend);
    console.log(`渲染后端: ${backend}`);

    await page.click("#batchBtn");
    await page.waitForFunction(() =>
      document.querySelectorAll("#batchTable tbody tr").length === 9,
    { timeout: 15000 });

    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#batchTable tbody tr")).map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) => td.textContent)
      )
    );
    const live = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#liveStats dt")).map((dt) =>
        [dt.textContent, dt.nextElementSibling.textContent]
      )
    );

    console.log("\n== 实时读数（极端 0.01–10000，默认 depth24） ==");
    live.forEach(([k, v]) => console.log(`${k.padEnd(28)} ${v}`));

    console.log("\n== 9 组配置（界面表格） ==");
    console.log(["mode", "ratio", "idealDelta", "lsb", "lsbCount",
      "zFight", "flicker"].join("\t"));
    rows.forEach((r) => console.log([
      r[0].padEnd(9), r[1].padStart(9), r[2].padStart(11),
      r[3].padStart(11), r[4].padStart(7), r[5].padStart(7), r[6].padStart(7),
    ].join("\t")));

    const find = (mode, ratioPart) =>
      rows.find((r) => r[0] === mode && r[1].includes(ratioPart));
    const reverseExtreme = find("reverse-z", "1e+6");
    const std24Extreme = find("depth24", "1e+6");
    if (!reverseExtreme || !std24Extreme) throw new Error("缺少极端比例测试行");
    if (Number(reverseExtreme[5]) !== 0) {
      throw new Error(`反向深度仍有 z-fighting: ${reverseExtreme[5]}`);
    }
    if (Number(std24Extreme[5]) === 0) {
      throw new Error("标准 depth24 极端比例应出现 z-fighting");
    }

    await saveFrame(page, backend, "depth24");
    await page.select("#depthMode", "reverse");
    await new Promise((r) => setTimeout(r, 500));
    await saveFrame(page, backend, "reverse");

    const jsErrors = errors.filter((e) => !e.includes("FBO"));
    if (jsErrors.length) throw new Error("页面脚本错误: " + jsErrors.join(" | "));
    console.log("\nE2E_OK: 反向深度远端零冲突，标准 Z 极端比例出现 z-fighting。");
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
