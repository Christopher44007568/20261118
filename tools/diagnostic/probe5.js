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
    const w = window.__water, r = w.renderer, gl = r.gl;
    const rt = r.reflectTarget;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
    const full = new Uint8Array(rt.w*rt.h*4);
    gl.readPixels(0,0,rt.w,rt.h,gl.RGBA,gl.UNSIGNED_BYTE,full);
    // Find rows containing green (trees/hills) to locate the scene content band
    const rowInfo = [];
    for (let y=0; y<rt.h; y+=rt.h/40) {
      let green=0, tan=0, dark=0;
      for (let x=0;x<rt.w;x+=8) {
        const i=(Math.floor(y)*rt.w+x)*4;
        const R=full[i],G=full[i+1],B=full[i+2];
        if (G>R+12 && G>B+8) green++;
        else if (R>90 && G>80 && B<90) tan++;
        else if (R<40) dark++;
      }
      rowInfo.push({readY:Math.floor(y), v:+(Math.floor(y)/rt.h).toFixed(2), green, tan, dark});
    }
    // For water point (0,0,-10): where does BOTH raw and flipped sample land?
    const uv = w.mirror.projectUV([0,0,-10]);
    return {band: rowInfo, waterUV: uv.map(v=>+v.toFixed(3)), rtH: rt.h};
  });
  console.log('water point UV:', out.waterUV, 'rtH', out.rtH);
  console.log('readY(v) green tan dark:');
  out.band.forEach(r=>console.log(r.readY, r.v, r.green, r.tan, r.dark));
  await browser.close();
})();
