import {readdir,readFile} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const base=process.argv[2]||'https://attention-atlas.pages.dev';
if(new URL(base).protocol!=='https:')throw new Error('Expected HTTPS deployment URL');
const digest=data=>createHash('sha256').update(data).digest('hex');
async function files(dir){const result=[];for(const ent of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,ent.name);result.push(...ent.isDirectory()?await files(p):[p]);}return result;}
const paths=(await files(resolve(root,'dist'))).filter(p=>!p.endsWith('/_headers'));
const results=await Promise.all(paths.map(async path=>{
 const name=relative(resolve(root,'dist'),path),res=await fetch(`${base}/${name==='index.html'?'':name}`,{signal:AbortSignal.timeout(20000)});
 const actual=Buffer.from(await res.arrayBuffer()),expected=await readFile(path);
 // Pages returns a real 404 status when requesting its custom error document.
 if((res.status!==200&&!(name==='404.html'&&res.status===404))||digest(actual)!==digest(expected))throw new Error(`${name}: HTTP ${res.status} or asset digest mismatch`);
 if(res.headers.get('x-content-type-options')!=='nosniff')throw new Error(`${name}: missing nosniff header`);
 if(!res.headers.get('content-security-policy')?.includes("script-src 'self'"))throw new Error(`${name}: missing restrictive script policy`);
 const cache=res.headers.get('cache-control')||'';if(name.startsWith('assets/')&&!cache.includes('immutable'))throw new Error(`${name}: missing immutable cache policy`);if(name==='index.html'&&cache.includes('immutable'))throw new Error('HTML must not be immutable');return {path:name,status:res.status,bytes:actual.length,cache};
}));
const missing=await fetch(`${base}/missing-page-verification`,{signal:AbortSignal.timeout(20000)});
if(missing.status!==404||!(await missing.text()).includes('A little off the map.'))throw new Error('Custom 404 failed');
console.log(JSON.stringify({base,assets:results,custom404:'pass'},null,2));
