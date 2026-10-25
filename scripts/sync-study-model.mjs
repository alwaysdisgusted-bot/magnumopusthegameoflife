import { readFileSync, writeFileSync } from 'node:fs';
const source=readFileSync(new URL('../public/study-model.js',import.meta.url),'utf8');
const start=source.indexOf("  'use strict';",source.indexOf('})(typeof globalThis'));
if(start<0||!source.endsWith('});\n'))throw new Error('Unexpected study model wrapper.');
const target='const StudyModel = (function () {\n'+source.slice(start,-4)+'})();\nexport default StudyModel;\n';
const url=new URL('../server/study-model.mjs',import.meta.url);
if(process.argv.includes('--check')){if(readFileSync(url,'utf8')!==target)throw new Error('Study model is out of sync.');}else writeFileSync(url,target);
