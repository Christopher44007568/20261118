const puppeteer=require('puppeteer-core');
(async()=>{
  const browser=await puppeteer.launch({executablePath:process.env.CHROME,headless:'new',
    args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
  const page=await browser.newPage();
  const logs=[];
  page.on('console',m=>logs.push(m.type()+': '+m.text()));
  await page.setViewport({width:1440,height:900});
  await page.goto('http://127.0.0.1:8765/index.html?normals&z=1',{waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,1800));
  const out=await page.evaluate(()=>{
    const r=window.__water.renderer, gl=r.gl;
    gl.useProgram(r.waterProg.prog);
    return {
      linked: gl.getProgramParameter(r.waterProg.prog, gl.LINK_STATUS),
      waterMeshCount: r.waterMesh.count,
      debugNormals: r.debug.normals,
      uNoGlintValue: gl.getUniform(r.waterProg.prog, r.waterProg.uniforms.uNoGlint.loc),
      glError: gl.getError()
    };
  });
  console.log('STATE:', JSON.stringify(out));
  console.log('CONSOLE:', logs.filter(l=>!l.includes('favicon')).join('\n'));
  await browser.close();
})();
