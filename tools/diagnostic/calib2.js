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
    const w=window.__water, r=w.renderer, gl=r.gl, rt=r.reflectTarget;
    const W=rt.w,H=rt.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
    const data=new Uint8Array(W*H*4);
    gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,data);
    const isRed=(i)=>data[i]>110&&data[i]<210&&data[i+1]<95&&data[i+2]<75;
    // centroid of red in readPixel coords
    let sx=0,sy=0,n=0;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;if(isRed(i)){sx+=x;sy+=y;n++;}}
    const redReadU=sx/n/W, redReadV=sy/n/H;
    const uv=w.mirror.projectUV([4.6,0,-6.2]);
    return {
      redReadU:+redReadU.toFixed(3), redReadV:+redReadV.toFixed(3),
      redTexU:+redReadU.toFixed(3), redTexV:+(1-redReadV).toFixed(3),
      waterMirrorU:+uv[0].toFixed(3), waterMirrorV:+uv[1].toFixed(3),
      note:'texture(u,v) samples readPixel row (1-v)*H'
    };
  });
  console.log(JSON.stringify(out,null,1));
  await browser.close();
})();
