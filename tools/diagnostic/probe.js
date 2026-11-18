const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME, headless: 'new',
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({width:1440,height:900});
  await page.goto('http://127.0.0.1:8765/index.html', {waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,2500));
  const out = await page.evaluate(() => {
    const w = window.__water;
    const pts = [[0,0,-4],[0,0,-15],[-20,0,-10],[20,0,-20],[0,0,10]];
    const samples = pts.map(p => {
      const uv = w.mirror.projectUV(p);
      return {p, uv: uv.map(v=>+v.toFixed(3))};
    });
    const gl = w.renderer.gl;
    const rt = w.renderer.reflectTarget;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
    const px = new Uint8Array(4);
    const probe = (u,v) => {
      const x = Math.floor(u*rt.w), y = Math.floor(v*rt.h);
      gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
      return Array.from(px).slice(0,3);
    };
    const colors = {
      centerFlip: probe(0.5, 0.5),
      centerNoFlip: probe(0.5, 0.5),
      top: probe(0.5, 0.95),
      bottom: probe(0.5, 0.05),
      left: probe(0.1, 0.7),
      right: probe(0.9, 0.7)
    };
    // scan a vertical line to find where dark content starts
    const scan = [];
    for (let i=0;i<=10;i++) scan.push({v: i/10, c: probe(0.5, i/10)});
    return {samples, colors, scan, rt:[rt.w,rt.h], eye:w.mirror.eye, clip:w.mirror.clipRow};
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
