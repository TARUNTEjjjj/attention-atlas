import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,rm,mkdir,mkdtemp,writeFile,appendFile,copyFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildSite} from '../scripts/build.mjs';
import {publicResourceFiles} from '../scripts/stage-resource-explorer.mjs';
import {LIVE_CATALOG_URL} from '../resources/catalog.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const outDir=resolve(root,'.build-test');
// A scratch copy of everything buildSite reads, so a test can litter src/ or aim outDir at a source folder safely.
async function project(t){
 const dir=await mkdtemp(resolve(tmpdir(),'atlas-build-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const folder of ['src','resources','scripts'])await mkdir(resolve(dir,folder));
 for(const entry of await readdir(resolve(root,'src'),{withFileTypes:true}))if(entry.isFile())await copyFile(resolve(root,'src',entry.name),resolve(dir,'src',entry.name));
 // Besides the pages and src/: the resource library's public files, the root offline worker, and the build scripts
 // whose bytes are part of the app version.
 for(const name of ['index.html','404.html','_headers','styles.css','favicon.svg','offline-resources-worker.js',...publicResourceFiles.map(file=>`resources/${file}`),
  'scripts/build.mjs','scripts/app-release.mjs','scripts/app-update-protocol.mjs','scripts/stage-resource-explorer.mjs'])await copyFile(resolve(root,name),resolve(dir,name));
 return dir;
}
test('release build: hashed assets resolve every page and module dependency; build is deterministic',async t=>{
 t.after(()=>rm(outDir,{recursive:true,force:true}));
 const first=await buildSite({root,outDir});
 const html=await readFile(resolve(outDir,'index.html'),'utf8');
 const manifest=JSON.parse(await readFile(resolve(outDir,'asset-manifest.json'),'utf8'));
 assert.ok(first.bytes<350000);assert.match(first.release,/^[a-f0-9]{16}$/);
 assert.equal(first.release,manifest.release);
 const appVersion=JSON.parse(await readFile(resolve(outDir,'app-version.json'),'utf8'));
 assert.match(html,new RegExp(appVersion.version));
 assert.match(await readFile(resolve(outDir,'offline-resources-worker.js'),'utf8'),new RegExp(appVersion.version));
 assert.match(await readFile(resolve(outDir,'resources/index.html'),'utf8'),new RegExp(appVersion.version));
 assert.doesNotMatch(html,/(?:href|src)="\/(?:src\/|styles\.css|favicon\.svg)/);
 for(const {path,sha256,bytes} of manifest.assets){
  assert.ok(path.startsWith(`/assets/${first.release}/`));
  const data=await readFile(resolve(outDir,'.'+path));
  assert.equal(data.length,bytes);assert.equal(createHash('sha256').update(data).digest('hex'),sha256);
  if(path.endsWith('.js'))for(const match of data.toString().matchAll(/\b(?:from|import)\s*\(?\s*['"](\.\.?\/[^'"]+)['"]/g))await readFile(resolve(dirname(resolve(outDir,'.'+path)),match[1]));
 }
 for(const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g))await readFile(resolve(outDir,'.'+match[1]));
 assert.equal((await buildSite({root,outDir})).release,first.release);
});
test('release build: cannot delete source tree as output directory',async()=>{
 await assert.rejects(buildSite({root,outDir:root}),/child of/);
});
test('release build: a source folder chosen as the output folder is refused and keeps its files; an earlier build is replaced',async t=>{
 const dir=await project(t);
 for(const [folder,file] of [['tests','build.test.js'],['docs','CAPACITY.md'],['.git','HEAD'],['.github','ci.yml']]){await mkdir(resolve(dir,folder));await writeFile(resolve(dir,folder,file),'keep me');}
 for(const folder of ['src','tests','docs','scripts','resources','.git','.github']){
  const before=await readdir(resolve(dir,folder));
  await assert.rejects(buildSite({root:dir,outDir:resolve(dir,folder)}),/protected/,folder);
  assert.deepEqual(await readdir(resolve(dir,folder)),before,`${folder} changed`);
 }
 // An earlier build is still replaced, also after Finder adds .DS_Store to it.
 const {release}=await buildSite({root:dir});await writeFile(resolve(dir,'dist','.DS_Store'),'');
 assert.equal((await buildSite({root:dir})).release,release);
 assert.ok(!(await readdir(resolve(dir,'dist'))).includes('.DS_Store'),'the earlier build was replaced');
});
test('release build: only what the pages load ships from src/; dotfiles, backups, copies, notes and symlinks change nothing',async t=>{
 const clean=await project(t),littered=await project(t),stray='not for publication';
 for(const name of ['.DS_Store','.env','.lessons.js.swp','progress.js.orig','lessons.js.bak','notes-draft.md','scratch.js','styles-draft.css'])await writeFile(resolve(littered,'src',name),stray);
 // Backups that keep their extension, as Finder's Duplicate and a hand-made copy do. They import the real modules.
 await copyFile(resolve(littered,'src','app.js'),resolve(littered,'src','app copy.js'));
 await copyFile(resolve(littered,'src','visual-labs.js'),resolve(littered,'src','visual-labs.old.js'));
 for(const folder of ['.cache','old']){await mkdir(resolve(littered,'src',folder));await copyFile(resolve(littered,'src','app.js'),resolve(littered,'src',folder,'app.js'));}
 await writeFile(resolve(littered,'outside.js'),stray);
 // A link to a file outside src/, and the dangling lock link Emacs keeps while app.js has unsaved edits. Windows may
 // need a privilege to create symlinks, so there these two are optional.
 try{await symlink('../outside.js',resolve(littered,'src','linked.js'));await symlink('user@host.1234:1',resolve(littered,'src','.#app.js'));}catch(error){if(error.code!=='EPERM')throw error;}
 const expected=await buildSite({root:clean}),actual=await buildSite({root:littered});
 assert.equal(actual.release,expected.release);
 assert.deepEqual(actual.assets,expected.assets);
 const tree=async dir=>(await readdir(resolve(dir,'dist'),{recursive:true})).sort();
 assert.deepEqual(await tree(littered),await tree(clean));
 // Nor does the app version, which the pages, both workers and app-version.json carry for the update check.
 assert.equal(await readFile(resolve(littered,'dist','app-version.json'),'utf8'),await readFile(resolve(clean,'dist','app-version.json'),'utf8'));
 // The manifest stays one the cold load test accepts: "app copy.js" would have put a space in an asset path.
 assert.ok(actual.assets.every(asset=>/^\/assets\/[a-f0-9]{16}\/[\w./-]+$/.test(asset.path)));
});
test('release build: from resources/ only the public files of the resource library count; a stray file there changes neither the app version nor the release',async t=>{
 const clean=await project(t),littered=await project(t),stray='not for publication';
 // The repository's own notes for the library, what Finder and an interrupted catalog refresh leave (.gitignore expects
 // resources/*.tmp), a copy and an old version kept in a folder.
 for(const name of ['README.md','sources.json'])await copyFile(resolve(root,'resources',name),resolve(littered,'resources',name));
 for(const name of ['.DS_Store','catalog.json.5f0c2a4e-8d1b-4c3a-9e2f-7a6b5c4d3e2f.tmp','explorer copy.css','notes.txt'])await writeFile(resolve(littered,'resources',name),stray);
 await mkdir(resolve(littered,'resources','old'));await copyFile(resolve(littered,'resources','explorer.mjs'),resolve(littered,'resources','old','explorer.mjs'));
 // The dangling lock link Emacs keeps while explorer.mjs has unsaved edits; optional where symlinks need a privilege.
 try{await symlink('user@host.1234:1',resolve(littered,'resources','.#explorer.mjs'));}catch(error){if(error.code!=='EPERM')throw error;}
 const expected=await buildSite({root:clean}),actual=await buildSite({root:littered});
 // The app version is stamped into both pages, both workers and app-version.json, and the release ID covers them.
 assert.equal(await readFile(resolve(littered,'dist','app-version.json'),'utf8'),await readFile(resolve(clean,'dist','app-version.json'),'utf8'));
 assert.equal(actual.release,expected.release);
 const tree=async dir=>(await readdir(resolve(dir,'dist'),{recursive:true})).sort();
 assert.deepEqual(await tree(littered),await tree(clean));
});
test('release build: a file ships once a page or a shipped module names it, wherever in src/ it is; a path that leaves src/ does not',async t=>{
 const clean=await project(t),grown=await project(t);
 const add=async(path,text)=>{await mkdir(dirname(resolve(grown,path)),{recursive:true});await writeFile(resolve(grown,path),text);};
 // What a later release might load: a bare import, a module in a subfolder, a lazy import(), a data file by URL, and
 // a second stylesheet linked from the page that imports another and points at an image.
 await appendFile(resolve(grown,'src','app.js'),`\nimport './extra.js';\nconst lazy=()=>import("./lazy.mjs"),data=new URL('./data/table.json',import.meta.url),elsewhere='../outside.js';\n`);
 await add('src/extra.js',"import {helper} from './deep/helper.js';\nexport default helper;\n");
 await add('src/deep/helper.js',"export {normalizeProgress as helper} from '../progress.js';\n");
 await add('src/lazy.mjs','export {default as lazy} from "./extra.js";\nexport * from "./deep/late.js?v=2";\nexport const hint="a quoted \'./not-a-file.js\' in text is not a file to ship";\n');
 await add('src/deep/late.js','export const late=true;\n');
 await add('src/data/table.json','[1,2,3]\n');
 await add('src/extra.css','@import url("./more.css");\n.dot{background:url(img/dot.svg)}\n.hash{fill:url(#dots)}\n');
 await add('src/more.css','.more{color:red}\n');
 await add('src/img/dot.svg','<svg xmlns="http://www.w3.org/2000/svg"/>\n');
 await add('src/unused.js','export const unused=true;\n');
 await add('outside.js','export const outside=true;\n');
 const page=await readFile(resolve(grown,'index.html'),'utf8');
 await writeFile(resolve(grown,'index.html'),page.replace('<script type="module" src="/src/app.js">','<link rel="stylesheet" href="/src/extra.css"><script type="module" src="/src/app.js">'));
 const before=await buildSite({root:clean}),after=await buildSite({root:grown});
 const shipped=build=>build.assets.map(asset=>asset.path.replace(`/assets/${build.release}/`,'')).sort();
 const added=['src/data/table.json','src/deep/helper.js','src/deep/late.js','src/extra.css','src/extra.js','src/img/dot.svg','src/lazy.mjs','src/more.css'];
 assert.deepEqual(shipped(after),[...shipped(before),...added].sort());
 for(const path of added)assert.equal(await readFile(resolve(grown,'dist','assets',after.release,path),'utf8'),await readFile(resolve(grown,path),'utf8'),path);
 assert.ok((await readFile(resolve(grown,'dist','index.html'),'utf8')).includes(`href="/assets/${after.release}/src/extra.css"`));
});
test('release build: a module that puts together the path of what it loads stops the build, which cannot tell what to ship',async t=>{
 for(const line of ["const lab=name=>import(`./labs/${name}.js`);","const lab=name=>import('./labs/'+name+'.js');"]){
  const dir=await project(t);
  await mkdir(resolve(dir,'src','labs'));await writeFile(resolve(dir,'src','labs','one.js'),'export default 1;\n');
  await appendFile(resolve(dir,'src','app.js'),`\n${line}\n`);
  await assert.rejects(buildSite({root:dir}),/src\/app\.js builds the path of what it loads from \.\/.* as it runs/,line);
  await assert.rejects(readdir(resolve(dir,'dist')),{code:'ENOENT'},'nothing is written');
 }
});
test('release build: both pages carry the release ID, and a page without </head> stops the build',async t=>{
 const dir=await project(t);
 const {release}=await buildSite({root:dir});
 for(const page of ['index.html','404.html'])assert.ok((await readFile(resolve(dir,'dist',page),'utf8')).includes(`<meta name="atlas-release" content="${release}"></head>`),page);
 await writeFile(resolve(dir,'404.html'),(await readFile(resolve(dir,'404.html'),'utf8')).replace(/<\/?head>/g,''));
 await assert.rejects(buildSite({root:dir}),/App HTML has no head/);
 // The build stopped at that page: no 404.html without the release ID was written.
 await assert.rejects(readFile(resolve(dir,'dist','404.html')),{code:'ENOENT'});
});
test('headers: immutable cache is limited to release-named assets; HTML is revalidated',async()=>{
 const headers=await readFile(resolve(root,'_headers'),'utf8');
 assert.match(headers,/\/assets\/\*\n  Cache-Control: public, max-age=31536000, immutable/);
 assert.match(headers,/\/index\.html\n  Cache-Control: public, max-age=0, must-revalidate/);
 assert.doesNotMatch(headers.split('/assets/*')[0],/Cache-Control.*immutable/);
});


test('build rejects source subdirectories and symlink ancestors without changing them', async t => {
  const { mkdtemp, writeFile, symlink } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const fixture = await mkdtemp(resolve(tmpdir(),'atlas-output-'));
  t.after(()=>rm(fixture,{recursive:true,force:true}));
  await mkdir(resolve(fixture,'src'));
  await writeFile(resolve(fixture,'src/keep.js'),'source');
  await writeFile(resolve(fixture,'.gitignore'),'keep');
  await assert.rejects(buildSite({root:fixture,outDir:resolve(fixture,'.gitignore')}),/existing file/);
  assert.equal(await readFile(resolve(fixture,'.gitignore'),'utf8'),'keep');
  for(const target of ['src','SRC','Src/nested','src/nested','scripts','tests','docs','.git','.GIT'])
    await assert.rejects(buildSite({root:fixture,outDir:resolve(fixture,target)}),/protected/);
  await symlink(resolve(fixture,'src'),resolve(fixture,'alias'));
  await assert.rejects(buildSite({root:fixture,outDir:resolve(fixture,'alias/output')}),/symbolic links/);
  assert.equal(await readFile(resolve(fixture,'src/keep.js'),'utf8'),'source');
});
test('headers: every response keeps nosniff, DENY framing, its referrer and permissions policies, and a CSP that allows only this origin, plus the catalog host for fetches',async()=>{
 const rules=[];
 for(const line of (await readFile(resolve(root,'_headers'),'utf8')).split('\n'))if(line.trim()){
  if(/^\S/.test(line)){rules.push({pattern:line.trim(),headers:new Map()});continue;}
  const at=line.indexOf(':');rules.at(-1).headers.set((at<0?line:line.slice(0,at)).trim().toLowerCase(),at<0?null:line.slice(at+1).trim());
 }
 const all=rules.find(rule=>rule.pattern==='/*').headers;
 assert.equal(all.get('x-content-type-options'),'nosniff');
 assert.equal(all.get('x-frame-options'),'DENY');
 assert.equal(all.get('referrer-policy'),'strict-origin-when-cross-origin');
 assert.equal(all.get('permissions-policy'),'camera=(), microphone=(), geolocation=()');
 const policy=Object.fromEntries(all.get('content-security-policy').split(';').map(directive=>directive.trim().split(/\s+/)).map(([name,...sources])=>[name,sources]));
 // The one other origin: where the resource library reads its public catalog (resources/catalog.mjs), for fetches only.
 const catalogHost=new URL(LIVE_CATALOG_URL).origin;
 assert.equal(catalogHost,'https://raw.githubusercontent.com');
 for(const [directive,sources] of [['default-src',["'self'"]],['script-src',["'self'"]],['connect-src',["'self'",catalogHost]],['object-src',["'none'"]],['base-uri',["'self'"]],['frame-ancestors',["'none'"]],['form-action',["'self'"]]])assert.deepEqual(policy[directive],sources,directive);
 // No wildcard, scheme, other host, eval, nonce or hash source anywhere, and 'unsafe-inline' only where the labs' style attributes need it.
 for(const [directive,sources] of Object.entries(policy))for(const source of sources)assert.ok(["'self'","'none'"].includes(source)||source==="'unsafe-inline'"&&['style-src','style-src-attr'].includes(directive)||source===catalogHost&&directive==='connect-src',`${directive} allows ${source}`);
 // A narrower rule must not drop or replace them for some paths.
 for(const rule of rules)if(rule.pattern!=='/*')for(const name of rule.headers.keys())assert.ok(!all.has(name.replace(/^!\s*/,'')),`${rule.pattern} changes ${name}`);
});
test('headers: the policy refuses injected <style> elements and data: images, neither of which the site uses',async()=>{
 // CSP Level 3 splits style-src: style-src-elem covers <style> elements and stylesheet links, style-src-attr covers
 // style="…" attributes. The labs need only the attributes (bar widths, heatmap shades). A browser without the split
 // directives falls back to style-src, whose 'unsafe-inline' still lets those attributes through.
 const headers=await readFile(resolve(root,'_headers'),'utf8');
 const policy=Object.fromEntries(/Content-Security-Policy: (.+)/.exec(headers)[1].split(';').map(directive=>directive.trim().split(/\s+/)).map(([name,...values])=>[name,values]));
 assert.deepEqual(policy['style-src-elem'],["'self'"]);
 assert.deepEqual(policy['style-src-attr'],["'unsafe-inline'"]);
 assert.deepEqual(policy['img-src'],["'self'"]);
 assert.deepEqual(policy['script-src'],["'self'"]);
 // catalog.json is data the page renders as text, refreshed daily from GitHub, so it is not scanned as markup.
 const shipped=['index.html','404.html','styles.css','offline-resources-worker.js',...(await readdir(resolve(root,'src'))).map(name=>`src/${name}`),...publicResourceFiles.filter(file=>file!=='catalog.json').map(file=>`resources/${file}`)];
 for(const path of shipped){
  const text=await readFile(resolve(root,path),'utf8');
  assert.doesNotMatch(text,/<style\b|createElement\(\s*['"]style['"]/i,`${path} adds a <style> element, which style-src-elem blocks`);
  assert.doesNotMatch(text,/(?:src|href)\s*=\s*["']?\s*data:|url\(\s*["']?\s*data:/i,`${path} loads a data: URL, which img-src blocks`);
 }
});
