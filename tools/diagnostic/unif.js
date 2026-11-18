const puppeteer=require('puppeteer-core');
(async()=>{
  const browser=await puppeteer.launch({executablePath:process.env.CHROME,headless:'new',
    args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
  const page=await browser.newPage();
  await page.setViewport({width:1440,height:900});
  await page.goto('http://127.0.0.1:8765/index.html?normals',{waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,1800));
  const out=await page.evaluate(()=>{
    const r=window.__water.renderer, gl=r.gl;
    const slot=r.waterProg.uniforms.uNoGlint;
    gl.useProgram(r.waterProg.prog);
    return {debugNormals:r.debug.normals, slotType:slot&&slot.type, INT:gl.INT, BOOL:gl.BOOL,
      uniformValue: gl.getUniform(r.waterProg.prog, slot.loc)};
  });
  console.log(JSON.stringify(out));
  await browser.close();
})();
