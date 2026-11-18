const puppeteer=require('puppeteer-core');
(async()=>{
  const browser=await puppeteer.launch({executablePath:process.env.CHROME,headless:'new',
    args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
  const page=await browser.newPage();
  await page.setViewport({width:1440,height:900});
  await page.goto('http://127.0.0.1:8765/index.html',{waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,2000));
  const out=await page.evaluate(()=>{
    const w=window.__water, m=w.mirror;
    // 1. mirror eye must be exact Y-reflection of main eye
    const eyeOk = Math.abs(m.eye[0]-w.camera.eye[0])<1e-4 &&
      Math.abs(m.eye[1]+w.camera.eye[1])<1e-4 &&
      Math.abs(m.eye[2]-w.camera.eye[2])<1e-4;
    // 2. above-water points inside frustum, below-water clipped, across spread
    const above=[[0,5,-10],[30,8,-20],[-40,3,-30],[10,12,-50]];
    const below=[[0,-2,-10],[20,-5,-8],[-30,-8,-25],[5,-1,-40]];
    const inside=p=>{const c=M4.transformPoint(m.viewProj,p);return c.every(v=>v>=-1&&v<=1);};
    const aboveAll=above.every(inside), belowNone=below.some(inside);
    // 3. reflection UV stays in [0,1] for all in-bounds water points
    let uvOk=true, minU=9,maxU=-9,minV=9,maxV=-9;
    for(let x=-70;x<=70;x+=10)for(let z=-22;z<=22;z+=6){
      const uv=m.projectUV([x,0,z]);
      minU=Math.min(minU,uv[0]);maxU=Math.max(maxU,uv[0]);
      minV=Math.min(minV,uv[1]);maxV=Math.max(maxV,uv[1]);
    }
    return {eyeReflectionOk:eyeOk, aboveWaterAllKept:aboveAll,
      belowWaterAnyLeaked:belowNone,
      uvRange:{u:[+minU.toFixed(3),+maxU.toFixed(3)],v:[+minV.toFixed(3),+maxV.toFixed(3)]},
      clipBias:m.clipBias, finite:m.finite};
  });
  console.log(JSON.stringify(out,null,1));
  await browser.close();
})();
