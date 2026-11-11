import fs from 'node:fs';
const roots=['app','components','lib','public'];
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${dir}/${e.name}`):[`${dir}/${e.name}`]);
const names=[...roots.flatMap(walk),...['package.json','package-lock.json','next.config.ts','tsconfig.json','eslint.config.mjs','proxy.ts','vercel.json']].filter(n=>!n.endsWith('.test.ts'));
const files=names.map(file=>({file,data:fs.readFileSync(file).toString('base64'),encoding:'base64'}));
if(process.argv.includes('--list'))console.log(JSON.stringify({count:files.length,bytes:JSON.stringify(files).length,names}));
else console.log(JSON.stringify(files));
