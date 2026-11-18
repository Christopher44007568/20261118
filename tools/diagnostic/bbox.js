const puppeteer=require('puppeteer-core');
(async()=>{
  const browser=await puppeteer.launch({executablePath:process.env.CHROME,headless:'new',
    args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
  const page=await browser.newPage();
  await page.setViewport({width:1440,height:900});
  await page.goto('http://127.0.0.1:8765/index.html',{waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,1500));
  const out=await page.evaluate(()=>{
    const w=window.__water, cam=w.camera;
    // project water corners through main VP
    const proj=M4.multiply(cam.proj,cam.view);
    const corners=[[-80,0,26],[80,0,26],[-80,0,-24],[80,0,-24],[0,0,0],[0,0,-24]];
    const screen=corners.map(p=>{const c=M4.transformPoint(proj,p);return {p,ndc:c.map(v=>+v.toFixed(2))};});
    return {eye:cam.eye, target:cam.target, screen, canvas:[w.renderer.canvas.width,w.renderer.canvas.height]};
  });
  console.log(JSON.stringify(out,null,1));
  await browser.close();
})();
