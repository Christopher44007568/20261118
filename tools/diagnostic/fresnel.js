const puppeteer=require('puppeteer-core');
(async()=>{
  const browser=await puppeteer.launch({executablePath:process.env.CHROME,headless:'new',
    args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
  const page=await browser.newPage();
  await page.setViewport({width:1440,height:900});
  await page.goto('http://127.0.0.1:8765/index.html',{waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,1800));
  // read main framebuffer water pixels at several depths
  const data=await page.evaluate(()=>{
    const r=window.__water.renderer, gl=r.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    const W=r.canvas.width,H=r.canvas.height;
    const px=new Uint8Array(4);
    const sample=(sx,sy)=>{gl.readPixels(Math.floor(sx*W),Math.floor(sy*H),1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);return Array.from(px).slice(0,3);};
    return {
      near: sample(0.5,0.85), mid: sample(0.5,0.65), far: sample(0.5,0.52),
      size:[W,H]
    };
  });
  console.log(JSON.stringify(data));
  await browser.close();
})();
