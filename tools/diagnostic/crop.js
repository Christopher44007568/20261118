const puppeteer=require('puppeteer-core');
(async()=>{
  const browser=await puppeteer.launch({executablePath:process.env.CHROME,headless:'new',
    args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
  const page=await browser.newPage();
  await page.setViewport({width:1440,height:900});
  await page.goto('http://127.0.0.1:8765/index.html',{waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,2000));
  await page.screenshot({path:'/tmp/full.png'});
  // clip central water region
  await page.screenshot({path:'/tmp/water-crop.png', clip:{x:350,y:520,width:750,height:330}});
  await browser.close();
})();
