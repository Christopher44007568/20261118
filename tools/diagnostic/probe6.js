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
    const w = window.__water, r = w.renderer, gl = r.gl, rt = r.reflectTarget;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
    const px=new Uint8Array(4);
    const at=(u,v)=>{gl.readPixels(Math.floor(u*rt.w),Math.floor(v*rt.h),1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);return Array.from(px).slice(0,3);};
    // water points: raw UV vs flipped UV colors
    return [[0,0,0],[0,0,-8],[0,0,-16]].map(p=>{
      const uv=w.mirror.projectUV(p);
      return {p, uvY:+uv[1].toFixed(3), raw:at(uv[0],uv[1]), flipped:at(uv[0],1-uv[1])};
    });
  });
  console.log(JSON.stringify(out,null,1));
  await browser.close();
})();
