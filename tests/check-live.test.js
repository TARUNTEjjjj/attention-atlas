import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {buildSite} from '../scripts/build.mjs';
import {publicResourceFiles} from '../scripts/stage-resource-explorer.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

// Builds the real site in a scratch project next to a copy of scripts/check-live.mjs. The build also reads the resource
// library's public files, the root offline worker and, for the app version, four build scripts.
async function site(t){
 const dir=await mkdtemp(resolve(tmpdir(),'atlas-live-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const folder of ['src','resources','scripts'])await mkdir(resolve(dir,folder));
 for(const entry of await readdir(resolve(root,'src'),{withFileTypes:true}))if(entry.isFile())await copyFile(resolve(root,'src',entry.name),resolve(dir,'src',entry.name));
 for(const name of ['index.html','404.html','_headers','styles.css','favicon.svg','offline-resources-worker.js',...publicResourceFiles.map(file=>`resources/${file}`),
  'scripts/build.mjs','scripts/app-release.mjs','scripts/app-update-protocol.mjs','scripts/stage-resource-explorer.mjs','scripts/check-live.mjs'])await copyFile(resolve(root,name),resolve(dir,name));
 const {release}=await buildSite({root:dir});
 return {dir,dist:resolve(dir,'dist'),release};
}
async function files(dir,prefix=''){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const name=prefix+entry.name;result.push(...entry.isDirectory()?await files(resolve(dir,entry.name),name+'/'):[name]);}return result;}
// What `wrangler pages deploy dist` uploads at this moment: never _headers, which Pages reads as configuration, and never
// a .DS_Store (Wrangler's Pages ignore list in wrangler-dist/cli.js).
const deploy=async dist=>(await files(dist)).filter(name=>name!=='_headers'&&!name.split('/').includes('.DS_Store'));

// Runs the real check-live in a child process against an offline stand-in for Cloudflare Pages: fetch is replaced, so
// nothing leaves the machine. The stand-in serves the deployed files and applies dist/_headers the way Pages does (each
// matching rule adds its headers, "! Name" removes one); `mode` then alters the headers it serves.
function checkLive({dir,dist},deployed,mode='faithful'){
 const code=`
  import {readFileSync} from 'node:fs';
  const dist=${JSON.stringify(dist)},deployed=new Set(${JSON.stringify(deployed)}),mode=${JSON.stringify(mode)};
  const rules=[];
  for(const line of readFileSync(dist+'/_headers','utf8').split('\\n'))if(line.trim()){const text=line.trim(),at=text.indexOf(':');if(/^\\S/.test(line))rules.push([text,[]]);else rules.at(-1)[1].push(text.startsWith('!')?[text.slice(1).trim(),null]:[text.slice(0,at).trim(),text.slice(at+1).trim()]);}
  globalThis.fetch=async url=>{
   const {origin,pathname}=new URL(url);
   if(origin!=='https://attention-atlas.pages.dev')throw new Error('Unexpected origin '+origin);
   const name=pathname==='/'?'index.html':pathname.slice(1),found=name!=='404.html'&&deployed.has(name);
   const headers=new Headers();
   for(const [pattern,list] of rules)if(pattern.endsWith('*')?pathname.startsWith(pattern.slice(0,-1)):pattern===pathname)for(const [key,value] of list)value===null?headers.delete(key):headers.append(key,value);
   if(mode==='no-frame-options')headers.delete('x-frame-options');
   if(mode==='wide-script-policy')headers.set('content-security-policy',headers.get('content-security-policy').replace("script-src 'self'","script-src 'self' 'unsafe-inline' 'unsafe-eval' *"));
   if(mode==='extra-script-directive')headers.set('content-security-policy',headers.get('content-security-policy')+"; script-src-elem 'self' 'unsafe-inline' *");
   if(mode==='cached-html'&&pathname==='/')headers.set('cache-control','public, max-age=31536000');
   return new Response(readFileSync(dist+'/'+(found?name:'404.html')),{status:found?200:404,headers});
  };
  process.argv=[process.argv[0],'check-live'];
  await import(${JSON.stringify(pathToFileURL(resolve(dir,'scripts','check-live.mjs')).href)});
 `;
 return new Promise((done,fail)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',code],{timeout:20000});let stdout='',stderr='';
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  child.on('error',fail);child.on('close',status=>done({status,stdout,stderr}));
 });
}

test('live check: a .DS_Store Finder writes into dist/, before or after the deploy, is not expected on the site',async t=>{
 const live=await site(t);
 await writeFile(resolve(live.dist,'.DS_Store'),'Bud1');
 const deployed=await deploy(live.dist);
 await writeFile(resolve(live.dist,'assets',live.release,'src','.DS_Store'),'Bud1');
 const result=await checkLive(live,deployed);
 assert.equal(result.status,0,result.stderr);
 const report=JSON.parse(result.stdout);
 assert.deepEqual(report.assets.map(asset=>asset.path).sort(),[...deployed].sort());
 assert.equal(report.custom404,'pass');
 // A file Wrangler does upload is still required: one the site lacks fails the check.
 await writeFile(resolve(live.dist,'extra.txt'),'not deployed');
 const drift=await checkLive(live,deployed);
 assert.equal(drift.status,1);assert.match(drift.stderr,/extra\.txt: HTTP 404/);
});
test('live check: any header that differs from dist/_headers fails, not only a missing nosniff or script-src',async t=>{
 const live=await site(t),deployed=await deploy(live.dist);
 const cases=[['faithful',null],
  ['no-frame-options',/x-frame-options is null, but _headers sets "DENY"/],
  ['wide-script-policy',/content-security-policy is "[^"]*'unsafe-eval'/],
  ['extra-script-directive',/content-security-policy is "[^"]*script-src-elem/],
  ['cached-html',/index\.html: cache-control is "public, max-age=31536000", but _headers sets "public, max-age=0, must-revalidate"/],
 ];
 const results=await Promise.all(cases.map(([mode])=>checkLive(live,deployed,mode)));
 for(const [index,[mode,message]] of cases.entries()){
  const {status,stderr}=results[index];
  if(message){assert.equal(status,1,mode);assert.match(stderr,message,mode);}else assert.equal(status,0,stderr);
 }
});
