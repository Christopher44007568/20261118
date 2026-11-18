const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME, headless: 'new',
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({width:1440,height:900});
  await page.goto('http://127.0.0.1:8765/index.html', {waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,1800));
  // Temporarily disable oblique by swapping mirror projection to plain proj
  const res = await page.evaluate(() => {
    const w=window.__water, m=w.mirror, r=w.renderer;
    const gl=r.gl, rt=r.reflectTarget;
    // sample the CURRENT live RT at the exact flipped UV the water uses
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
    const px=new Uint8Array(4);
    const atTex=(u,v)=>{ // texture coord -> readPixel
      gl.readPixels(Math.floor(u*rt.w), Math.floor((1-v)*rt.h),1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
      return Array.from(px).slice(0,3);
    };
    // water points across the lake, their flipped texture coordinate
    const pts=[[0,0,5],[0,0,-5],[0,0,-12],[0,0,-20],[-25,0,-10],[25,0,-10]];
    return pts.map(p=>{
      const uv=m.projectUV(p);
      const flipV=1-uv[1];
      return {p, texV:+flipV.toFixed(3), color:atTex(uv[0],flipV)};
    });
  });
  res.forEach(r=>console.log(JSON.stringify(r.p),'texV',r.texV,'rgb',r.color.join(',')));
  await browser.close();
})();
