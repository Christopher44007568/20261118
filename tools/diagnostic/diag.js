const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME, headless: 'new',
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({width:1440,height:900});
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  page.on('console', m => console.log('CONSOLE', m.type(), m.text()));
  await page.goto('http://127.0.0.1:8765/index.html', {waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,3000));
  const state = await page.evaluate(() => ({
    hasWater: !!window.__water,
    frame: window.__water ? window.__water.renderer.stats.frame : null,
    gl: (()=>{const c=document.getElementById('gl'); return !!c.getContext('webgl2');})()
  }));
  console.log('STATE:', JSON.stringify(state));
  await page.screenshot({path:'/tmp/diag.png'});
  await browser.close();
})();
