const puppeteer=require('puppeteer-core');
(async()=>{
  const browser=await puppeteer.launch({executablePath:process.env.CHROME,headless:'new',
    args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
  const page=await browser.newPage();
  await page.setViewport({width:1440,height:900});
  await page.goto('http://127.0.0.1:8765/index.html',{waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,1500));
  const out=await page.evaluate(()=>{
    const r=window.__water.renderer, gl=r.gl;
    const prog=r.waterProg.prog;
    const n=gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    const list=[];
    for(let i=0;i<n;i++){const info=gl.getActiveUniform(prog,i);list.push(info.name);}
    return {count:n, uniforms:list, fsHasHard: WATER_FS.includes('HARD DEBUG'), fsLength:WATER_FS.length};
  });
  console.log(JSON.stringify(out,null,1));
  await browser.close();
})();
