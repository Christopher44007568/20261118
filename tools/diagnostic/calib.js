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
    // buoy center is at world (4.6, 0.28, -6.2). Water point directly below at (4.6,0,-6.2).
    const waterP=[4.6,0,-6.2];
    const uv=w.mirror.projectUV(waterP);
    // dump RT region around both flipped and raw uv
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
    const W=rt.w,H=rt.h;
    const data=new Uint8Array(W*H*4);
    gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,data);
    const findRed=(u0,u1,v0,v1)=>{
      let cnt=0,sumR=0,sumG=0,ys=[];
      for(let y=Math.floor(v0*H);y<v1*H;y+=2)for(let x=Math.floor(u0*W);x<u1*W;x+=2){
        const i=(y*W+x)*4;
        if(data[i]>110 && data[i]<200 && data[i+1]<90 && data[i+2]<70){cnt++;sumR+=data[i];sumG+=data[i+1];if(ys.length<1)ys.push(y/H);}
      }
      return {cnt, avgR:cnt?sumR/cnt:0, ys};
    };
    // where is red in whole RT (readV coords)?
    const redRows={};
    for(let y=0;y<H;y+=4){let c=0;for(let x=0;x<W;x+=6){const i=(y*W+x)*4;if(data[i]>110&&data[i+1]<90&&data[i+2]<70)c++;}if(c>0)redRows[(y/H).toFixed(2)]=c;}
    return {waterUV:uv.map(v=>+v.toFixed(3)), redReadV:Object.keys(redRows), rtH:H};
  });
  console.log(JSON.stringify(out,null,1));
  await browser.close();
})();
