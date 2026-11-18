// 无头截图工具:生成 artifacts/ 下的验证图
// 用法: node tools/capture.js [outDir]
// 需要: npm i puppeteer (且已安装 Chrome, 或设 CHROME_PATH)
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer");

const ROOT = path.join(__dirname, "..");
const OUT = process.argv[2] || path.join(ROOT, "artifacts");
const PAGE = `file://${path.join(ROOT, "index.html")}`;
const EXE = process.env.CHROME_PATH || undefined;
const SWEEP_AZ = [28, 118, 208, 298];

async function launch() {
  return puppeteer.launch({
    headless: true,
    executablePath: EXE,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
}
async function shot(browser, url, file, { w = 1440, h = 900, selector = null } = {}) {
  const pg = await browser.newPage();
  await pg.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await pg.goto(url, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 2200));
  const target = selector ? await pg.$(selector) : pg;
  await target.screenshot({ path: file });
  const diag = await pg.evaluate(() => ({
    checks: document.getElementById("consistency").textContent,
    dirH: document.getElementById("mDirH").textContent,
    dirV: document.getElementById("mDirV").textContent,
    peakH: document.getElementById("mPeakH").textContent,
    peakV: document.getElementById("mPeakV").textContent,
  }));
  await pg.close();
  return diag;
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const report = {};
  report.lighting = await shot(browser, PAGE, path.join(OUT, "lighting.png"));
  report.tangent = await shot(browser, `${PAGE}?view=tangent`, path.join(OUT, "tangent.png"));
  report.stage = await shot(browser, PAGE, path.join(OUT, "stage.png"), { selector: "#gl" });

  // 光源扫描:固定相机,4 个方位角 → 2x2 拼图
  const tiles = [];
  for (const az of SWEEP_AZ) {
    const f = path.join(OUT, `_sweep_${az}.png`);
    report[`az${az}`] = await shot(browser, `${PAGE}?az=${az}`, f, { w: 1280, h: 800 });
    tiles.push(f);
  }
  const comp = await browser.newPage();
  await comp.setViewport({ width: 2560, height: 1600, deviceScaleFactor: 1 });
  const imgs = tiles.map((f) => `data:image/png;base64,${fs.readFileSync(f).toString("base64")}`);
  await comp.setContent(`<body style="margin:0;background:#000;display:grid;
    grid-template-columns:1fr 1fr;width:2560px;height:1600px">
    ${imgs.map((u) => `<img src="${u}" style="width:1280px;height:800px">`).join("")}
    </body>`);
  await new Promise((r) => setTimeout(r, 800));
  await comp.screenshot({ path: path.join(OUT, "light-sweep.png") });
  await comp.close();
  for (const f of tiles) fs.unlinkSync(f);
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
