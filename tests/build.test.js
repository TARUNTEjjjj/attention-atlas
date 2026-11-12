import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,rm,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildSite} from '../scripts/build.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const outDir=resolve(root,'.build-test');
test('release build: hashed assets resolve every page and module dependency; build is deterministic',async t=>{
 t.after(()=>rm(outDir,{recursive:true,force:true}));
 const first=await buildSite({root,outDir});
 const html=await readFile(resolve(outDir,'index.html'),'utf8');
 const manifest=JSON.parse(await readFile(resolve(outDir,'asset-manifest.json'),'utf8'));
 assert.ok(first.bytes<350000);assert.match(first.release,/^[a-f0-9]{16}$/);
 assert.equal(first.release,manifest.release);
 assert.doesNotMatch(html,/(?:href|src)="\/(?:src\/|styles\.css|favicon\.svg)/);
 for(const {path,sha256,bytes} of manifest.assets){
  assert.ok(path.startsWith(`/assets/${first.release}/`));
  const data=await readFile(resolve(outDir,'.'+path));
  assert.equal(data.length,bytes);assert.equal(createHash('sha256').update(data).digest('hex'),sha256);
  if(path.endsWith('.js'))for(const match of data.toString().matchAll(/from\s+['"](\.\/[^'"]+)['"]/g))await readFile(resolve(dirname(resolve(outDir,'.'+path)),match[1]));
 }
 for(const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g))await readFile(resolve(outDir,'.'+match[1]));
 assert.equal((await buildSite({root,outDir})).release,first.release);
});
test('release build: cannot delete source tree as output directory',async()=>{
 await assert.rejects(buildSite({root,outDir:root}),/child of/);
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
