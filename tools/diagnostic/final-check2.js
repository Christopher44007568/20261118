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
    // realistic above-water scene objects (trees/hills/buoy region)
    const above=[[0,6,-15],[4.6,2,-6.2],[21,3,-8],[-15,5,-30],[10,8,-40],[-30,4,-35]];
    const below=[[0,-2,-10],[4.6,-1.5,-6.2],[21,-3,-8],[-20,-4,-12],[12,-6,-20],[0,-8,5]];
    const ndc=p=>M4.transformPoint(m.viewProj,p);
    const inside=c=>c.every(v=>v>=-1&&v<=1);
    return {
      above: above.map(p=>({p, ndc:ndc(p).map(v=>+v.toFixed(2)), kept:inside(ndc(p))})),
      below: below.map(p=>({p, ndc:ndc(p).map(v=>+v.toFixed(2)), clipped:!inside(ndc(p))}))
    };
  });
  console.log('ABOVE WATER (should all be kept=true):');
  out.above.forEach(r=>console.log(' ',r.p, r.kept, r.ndc));
  console.log('BELOW WATER (should all be clipped=true):');
  out.below.forEach(r=>console.log(' ',r.p, r.clipped, r.ndc));
  await browser.close();
})();
