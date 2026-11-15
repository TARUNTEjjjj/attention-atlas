import {readdir,readFile} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const base=process.argv[2]||'https://attention-atlas.pages.dev';
if(new URL(base).protocol!=='https:')throw new Error('Expected HTTPS deployment URL');
const digest=data=>createHash('sha256').update(data).digest('hex');
// `wrangler pages deploy dist` never uploads _headers or the other top-level Pages configuration names, nor Finder's
// .DS_Store or a node_modules or .git folder at any depth (Wrangler's Pages ignore list), so none of them is expected live.
const configuration=new Set(['_worker.js','_redirects','_headers','_routes.json','functions','.wrangler']),neverUploaded=new Set(['.DS_Store','node_modules','.git']);
async function files(dir,top=true){const result=[];for(const ent of await readdir(dir,{withFileTypes:true})){if(neverUploaded.has(ent.name)||top&&configuration.has(ent.name))continue;const p=resolve(dir,ent.name);result.push(...ent.isDirectory()?await files(p,false):[p]);}return result;}
const paths=await files(resolve(root,'dist'));
// Every header dist/_headers gives a path, applied the way Pages applies it: each matching rule adds its headers, a header
// two rules set is joined with ", ", and "! Name" drops one. So a missing X-Frame-Options or a widened CSP fails the check.
const pattern=rule=>new RegExp('^'+rule.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/:\w+/g,'[^/]+')+'$');
const rules=[];
for(const line of (await readFile(resolve(root,'dist','_headers'),'utf8')).split(/\r?\n/)){
 const text=line.trim();if(!text||text.startsWith('#'))continue;
 if(/^\S/.test(line)){if(!text.startsWith('/'))throw new Error(`Unsupported _headers rule: ${text}`);rules.push({match:pattern(text),headers:[]});continue;}
 const at=text.indexOf(':');rules.at(-1).headers.push(text.startsWith('!')?[text.slice(1).trim().toLowerCase(),null]:[text.slice(0,at).trim().toLowerCase(),text.slice(at+1).trim()]);
}
function expectedHeaders(path){const result=new Map();for(const rule of rules)if(rule.match.test(path))for(const [name,value] of rule.headers)value===null?result.delete(name):result.set(name,result.has(name)?`${result.get(name)}, ${value}`:value);return result;}
const results=await Promise.all(paths.map(async path=>{
 const name=relative(resolve(root,'dist'),path),res=await fetch(`${base}/${name==='index.html'?'':name}`,{signal:AbortSignal.timeout(20000)});
 const actual=Buffer.from(await res.arrayBuffer()),expected=await readFile(path);
 // Pages returns a real 404 status when requesting its custom error document.
 if((res.status!==200&&!(name==='404.html'&&res.status===404))||digest(actual)!==digest(expected))throw new Error(`${name}: HTTP ${res.status} or asset digest mismatch`);
 for(const [header,value] of expectedHeaders(name==='index.html'?'/':`/${name}`))if(res.headers.get(header)!==value)throw new Error(`${name}: ${header} is ${JSON.stringify(res.headers.get(header))}, but _headers sets ${JSON.stringify(value)}`);
 if(res.headers.get('x-content-type-options')!=='nosniff')throw new Error(`${name}: missing nosniff header`);
 if(!res.headers.get('content-security-policy')?.includes("script-src 'self'"))throw new Error(`${name}: missing restrictive script policy`);
 const cache=res.headers.get('cache-control')||'';if(name.startsWith('assets/')&&!cache.includes('immutable'))throw new Error(`${name}: missing immutable cache policy`);if(name==='index.html'&&cache.includes('immutable'))throw new Error('HTML must not be immutable');return {path:name,status:res.status,bytes:actual.length,cache};
}));
const missing=await fetch(`${base}/missing-page-verification`,{signal:AbortSignal.timeout(20000)});
if(missing.status!==404||!(await missing.text()).includes('A little off the map.'))throw new Error('Custom 404 failed');
console.log(JSON.stringify({base,assets:results,custom404:'pass'},null,2));
