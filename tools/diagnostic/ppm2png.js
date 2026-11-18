const fs=require('fs'),{PNG}=require('pngjs');
const input=process.argv[2], output=process.argv[3];
const raw=fs.readFileSync(input);
const headerEnd = raw.indexOf(10, raw.indexOf(10, raw.indexOf(10)+1)+1)+1;
const header = raw.slice(0,headerEnd).toString().trim().split(/\s+/);
const w=+header[1], h=+header[2];
let idx=headerEnd;
const png=new PNG({width:w,height:h});
for(let i=0;i<w*h;i++){png.data[i*4]=raw[idx++];png.data[i*4+1]=raw[idx++];png.data[i*4+2]=raw[idx++];png.data[i*4+3]=255;}
fs.writeFileSync(output, PNG.sync.write(png));
console.log('wrote',output,w,h);
