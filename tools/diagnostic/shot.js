const puppeteer = require('puppeteer-core');
const url = process.argv[2] || '';
const out = process.argv[3] || '/tmp/shot.png';
(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME, headless: 'new',
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({width:1440,height:900});
  await page.goto('http://127.0.0.1:8765/index.html'+url, {waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,2500));
  await page.screenshot({path: out});
  await browser.close();
})();
