const puppeteer=require('puppeteer-core');
(async()=>{
  const browser=await puppeteer.launch({executablePath:process.env.CHROME,headless:'new',
    args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
  for (const [regime,out] of [['current','/tmp/shore-current.png'],['calm','/tmp/shore-calm.png']]) {
    const page=await browser.newPage();
    await page.setViewport({width:1440,height:900});
    await page.goto('http://127.0.0.1:8765/index.html?regime='+regime,{waitUntil:'domcontentloaded'});
    await new Promise(r=>setTimeout(r,2200));
    // waterline band where reflections meet the far shore
    await page.screenshot({path:out, clip:{x:0,y:380,width:1440,height:260}});
    await page.close();
  }
  await browser.close();
  console.log('done');
})();
