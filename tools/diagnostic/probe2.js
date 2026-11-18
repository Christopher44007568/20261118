const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME, headless: 'new',
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({width:1440,height:900});
  await page.goto('http://127.0.0.1:8765/index.html', {waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,2000));
  const out = await page.evaluate(() => {
    const w = window.__water, m = w.mirror;
    const test = [[0,5,-10],[0,1,-10],[0,0,-10],[0,-1,-10],[0,-5,-10],[10,8,-30],[-10,3,-20]];
    const ndc = test.map(p => {
      const c = M4.transformPoint(m.viewProj, p);
      return {p, ndc:c.map(v=>+v.toFixed(3)), inside: c.every(v=>v>=-1&&v<=1)};
    });
    return {eye:m.eye, clipPlane:Array.from(m.clipRow).map(v=>+v.toFixed(4)),
      proj:Array.from(m.proj).map(v=>+v.toFixed(4)), ndc};
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
