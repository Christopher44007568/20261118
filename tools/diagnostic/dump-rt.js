const puppeteer = require('puppeteer-core');
const fs = require('fs');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME, headless: 'new',
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({width:1440,height:900});
  await page.goto('http://127.0.0.1:8765/index.html', {waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,2000));
  const dims = await page.evaluate(() => {
    const r = window.__water.renderer, gl = r.gl, rt = r.reflectTarget;
    const data = new Uint8Array(rt.w*rt.h*4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
    gl.readPixels(0,0,rt.w,rt.h,gl.RGBA,gl.UNSIGNED_BYTE,data);
    window.__rtDump = {w:rt.w,h:rt.h,data:Array.from(data)};
    return [rt.w, rt.h];
  });
  const dump = await page.evaluate(() => window.__rtDump);
  // write PPM (bottom-up as read) for inspection
  const {w,h,data} = dump;
  let ppm = `P6\n${w} ${h}\n255\n`;
  const buf = Buffer.alloc(w*h*3);
  for (let i=0;i<w*h;i++){buf[i*3]=data[i*4];buf[i*3+1]=data[i*4+1];buf[i*3+2]=data[i*4+2];}
  fs.writeFileSync('/tmp/rt.ppm', Buffer.concat([Buffer.from(ppm,'ascii'), buf]));
  // average colors of horizontal thirds
  for (const [name,y0,y1] of [['top-third',0,h/3],['mid',h/3,2*h/3],['bottom',2*h/3,h]]) {
    let R=0,G=0,B=0,n=0;
    for(let y=Math.floor(y0);y<y1;y+=4)for(let x=0;x<w;x+=8){
      const i=(y*w+x)*4;R+=data[i];G+=data[i+1];B+=data[i+2];n++;
    }
    console.log(name, 'avg', (R/n).toFixed(0),(G/n).toFixed(0),(B/n).toFixed(0));
  }
  await browser.close();
})();
