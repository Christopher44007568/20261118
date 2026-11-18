const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME, headless: 'new',
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({width:1440,height:900});
  await page.goto('http://127.0.0.1:8765/index.html', {waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,1500));
  const out = await page.evaluate(() => {
    const w = window.__water, m = w.mirror;
    // eye-space positions of above/below water points
    const eyePts = [[0,5,-10],[0,-5,-10],[0,0.1,-10],[0,-0.1,-10]].map(p => {
      const e = M4.transformPoint(m.view, p);
      const plane = m.clipRow;
      const d = plane[0]*e[0]+plane[1]*e[1]+plane[2]*e[2]+plane[3];
      return {world:p, eye:e.map(v=>+v.toFixed(2)), planeDist:+d.toFixed(3)};
    });
    return {plane:Array.from(m.clipRow).map(v=>+v.toFixed(4)), eyePts};
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
