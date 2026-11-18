const puppeteer=require('puppeteer-core');
(async()=>{
  const browser=await puppeteer.launch({executablePath:process.env.CHROME,headless:'new',
    args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
  const page=await browser.newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push('PAGE: '+e.message));
  page.on('console',m=>{if(m.type()==='error')errs.push('CON: '+m.text());});
  await page.setViewport({width:1440,height:900});
  await page.goto('http://127.0.0.1:8765/index.html',{waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,1500));
  const out=await page.evaluate(()=>{
    const r=window.__water.renderer, gl=r.gl;
    // manual recompile to surface any GLSL error
    try {
      const p = GLU.createProgram(gl, WATER_VS, WATER_FS);
      return {recompile:'OK', activeUniforms:Object.keys(p.uniforms)};
    } catch(e) { return {recompile:'FAIL', err:String(e)}; }
  });
  console.log('RECOMPILE:', JSON.stringify(out,null,1));
  console.log('ERRORS:', errs.filter(e=>!e.includes('favicon')).join('\n')||'none');
  await browser.close();
})();
