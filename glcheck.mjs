import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  executablePath: '/home/hj/userfeedback2/uid5-0065/.browser/chrome-linux64/chrome',
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage();
const info = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (!gl) return null;
  return { version: gl.getParameter(gl.VERSION), renderer: gl.getParameter(gl.RENDERER) };
});
console.log(JSON.stringify(info));
await browser.close();
