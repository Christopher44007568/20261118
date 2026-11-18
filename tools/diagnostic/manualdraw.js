const puppeteer=require('puppeteer-core');
(async()=>{
  const browser=await puppeteer.launch({executablePath:process.env.CHROME,headless:'new',
    args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
  const page=await browser.newPage();
  await page.setViewport({width:1440,height:900});
  await page.goto('http://127.0.0.1:8765/index.html',{waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,1500));
  const info=await page.evaluate(()=>{
    const r=window.__water.renderer, gl=r.gl;
    // inspect water VAO bindings
    const m=r.waterMesh;
    gl.bindVertexArray(m.vao);
    const vboBound = gl.isBuffer(m.vbo), iboBound=gl.isBuffer(m.ibo);
    gl.bindVertexArray(null);
    // is cull face enabled and what mode
    return {vboBound, iboBound, indexed:m.indexed, count:m.count,
      cullEnabled: gl.isEnabled(gl.CULL_FACE),
      depthEnabled: gl.isEnabled(gl.DEPTH_TEST),
      cullFaceMode: (()=>{gl.enable(gl.CULL_FACE);return gl.getParameter(gl.CULL_FACE_MODE);})()};
  });
  console.log(JSON.stringify(info,null,1));
  await browser.close();
})();
