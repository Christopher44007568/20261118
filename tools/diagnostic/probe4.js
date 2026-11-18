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
    const px = new Uint8Array(4);
    const at = (u,v) => {
      gl.readPixels(Math.floor(u*rt.w), Math.floor(v*rt.h),1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
      return Array.from(px).slice(0,3);
    };
    // vertical scan at u=0.5 to map content bands in raw RT
    const scan = [];
    for (let i=0;i<=20;i++) scan.push({v:+(i/20).toFixed(2), c:at(0.5, i/20)});
    // water surface points and their projected mirror UV
    const pts = [[0,0,0],[0,0,-5],[0,0,-15],[0,0,-20],[-30,0,-5],[30,0,-15]];
    const mapped = pts.map(p => {
      const uv = w.mirror.projectUV(p);
      return {p, uv:uv.map(v=>+v.toFixed(3)), raw:at(uv[0],uv[1]), flipped:at(uv[0],1-uv[1])};
    });
    return {scan, mapped, rtSize:[rt.w,rt.h]};
  });
  console.log('VERTICAL SCAN (raw RT):');
  out.scan.forEach(s=>console.log(s.v, s.c.join(',')));
  console.log('\nWATER POINTS:');
  out.mapped.forEach(m=>console.log(JSON.stringify(m.p), 'uv',m.uv, 'raw',m.raw, 'flip',m.flipped));
  await browser.close();
})();
