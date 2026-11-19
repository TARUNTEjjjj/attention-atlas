import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

// Runs the real generator in a scratch copy, because it rewrites docs/CAPACITY.md next to the reports it reads.
// `edit` changes a copy of each committed report first, standing in for a later load run.
async function summarize(t,edit=report=>report){
  const dir=await mkdtemp(resolve(tmpdir(),'atlas-capacity-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(resolve(dir,'scripts'));await mkdir(resolve(dir,'docs','load-results'),{recursive:true});
  await copyFile(resolve(root,'scripts','summarize-load.mjs'),resolve(dir,'scripts','summarize-load.mjs'));
  for(const name of (await readdir(resolve(root,'docs','load-results'))).filter(name=>name.endsWith('.json')))
    await writeFile(resolve(dir,'docs','load-results',name),JSON.stringify(edit(JSON.parse(await readFile(resolve(root,'docs','load-results',name),'utf8')),name)));
  const {status,stderr}=await new Promise((done,fail)=>{
    const child=spawn(process.execPath,[resolve(dir,'scripts','summarize-load.mjs')],{timeout:10000});let stderr='';
    child.stderr.on('data',data=>stderr+=data);child.on('error',fail);child.on('close',status=>done({status,stderr}));
  });
  // The first line of the report it wrote, or null if it wrote none.
  const text=await readFile(resolve(dir,'docs','CAPACITY.md'),'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  return {status,stderr,heading:text===null?null:text.split('\n')[0],text};
}
async function capacityReport(t,edit,{full=false}={}){
  const {status,stderr,heading,text}=await summarize(t,edit);
  assert.equal(status,0,stderr);
  return full?text:heading;
}
const measured=release=>report=>({...report,buildSnapshot:{...report.buildSnapshot,release}});

test('capacity report: the heading names the release the reports measured, not a fixed version',async t=>{
  const [committed,rerun,mixed]=await Promise.all([
    capacityReport(t),
    capacityReport(t,measured('dbcdab1bc2bbfa9b')),
    capacityReport(t,(report,name)=>name==='cold-smoke.json'?measured('dbcdab1bc2bbfa9b')(report):report),
  ]);
  assert.equal(committed,'# Measured capacity workload — Attention Atlas release 9369f6aceda5b33c (app version unknown)');
  // A later run against another deployment is labelled with that deployment, not with 1.1.
  assert.equal(rerun,'# Measured capacity workload — Attention Atlas release dbcdab1bc2bbfa9b (app version unknown)');
  // Reports from two releases name both, rather than one standing for the other.
  assert.equal(mixed,'# Measured capacity workload — Attention Atlas releases 9369f6aceda5b33c (app version unknown); dbcdab1bc2bbfa9b (app version unknown)');
});

test('capacity report: a report that does not record its release stops the summary, instead of being listed under another run\'s release',async t=>{
  // load-test.mjs writes release: null for an html or warm run made without dist/asset-manifest.json. Such a report
  // was left out of the heading, which then named only the other runs' release above a table that listed all of them.
  const smoke=change=>(report,name)=>name==='cold-smoke.json'?change(report):report;
  for(const edit of [smoke(measured(null)),smoke(report=>({...report,buildSnapshot:undefined}))]){
    const {status,stderr,heading}=await summarize(t,edit);
    assert.notEqual(status,0);
    assert.match(stderr,/No release is recorded in cold-smoke\.json\./);
    assert.equal(heading,null,'no report is written');
  }
});

// Offline fixtures for the application version (issue #12). Each edit stands in for a report written by load-test.mjs.
const versioned=(release,applicationVersion)=>report=>({...report,buildSnapshot:{...report.buildSnapshot,release,applicationVersion}});
const row=(text,name)=>text.split('\n').find(line=>line.startsWith(`| [${name}]`)).split('|').map(cell=>cell.trim());

test('capacity report: a new report shows its application version beside the release it measured',async t=>{
  const text=await capacityReport(t,versioned('dbcdab1bc2bbfa9b','1.2.0'),{full:true});
  assert.equal(text.split('\n')[0],'# Measured capacity workload — Attention Atlas release dbcdab1bc2bbfa9b (app version 1.2.0)');
  assert.deepEqual(row(text,'cold-smoke.json').slice(2,4),['dbcdab1bc2bbfa9b','1.2.0']);
  assert.match(text,/Release measured: dbcdab1bc2bbfa9b, app version 1\.2\.0\./);
});

test('capacity report: a legacy report without an application version reads as unknown, never as the current package version',async t=>{
  const current=JSON.parse(await readFile(resolve(root,'package.json'),'utf8')).version;
  // The committed reports predate the field; also cover a report that wrote it as null.
  for(const edit of [undefined,report=>({...report,buildSnapshot:{...report.buildSnapshot,applicationVersion:null}})]){
    const text=await capacityReport(t,edit,{full:true});
    for(const name of ['cold-10000.json','cold-baseline.json','cold-smoke.json'])assert.deepEqual(row(text,name).slice(2,4),['9369f6aceda5b33c','unknown']);
    assert.match(text,/Release measured: 9369f6aceda5b33c, app version unknown\./);
    assert.ok(!text.includes(current),`the current package version ${current} is not attributed to old runs`);
  }
});

test('capacity report: mixed reports keep each release beside its own version, and list every version one release was recorded under',async t=>{
  // A new release with a version next to legacy runs of the old release.
  const mixedReleases=await capacityReport(t,(report,name)=>name==='cold-smoke.json'?versioned('dbcdab1bc2bbfa9b','1.3.0')(report):report,{full:true});
  assert.equal(mixedReleases.split('\n')[0],'# Measured capacity workload — Attention Atlas releases 9369f6aceda5b33c (app version unknown); dbcdab1bc2bbfa9b (app version 1.3.0)');
  assert.deepEqual(row(mixedReleases,'cold-smoke.json').slice(2,4),['dbcdab1bc2bbfa9b','1.3.0']);
  assert.deepEqual(row(mixedReleases,'cold-baseline.json').slice(2,4),['9369f6aceda5b33c','unknown']);
  // One release measured by a legacy report and by reports recording two versions (a version bump that shipped no file
  // changes keeps the release ID): every version is named, known ones first, and unknown is not dropped.
  const versions={'cold-10000.json':'1.2.1','cold-baseline.json':'1.2.0'};
  const sameRelease=await capacityReport(t,(report,name)=>name in versions?versioned('9369f6aceda5b33c',versions[name])(report):report);
  assert.equal(sameRelease,'# Measured capacity workload — Attention Atlas release 9369f6aceda5b33c (app versions 1.2.0, 1.2.1, unknown)');
});

test('capacity report: an application version that is not a version string stops the summary instead of being printed',async t=>{
  for(const bad of ['1.2.0 | injected',42,'']){
    const {status,stderr,heading}=await summarize(t,(report,name)=>name==='cold-smoke.json'?{...report,buildSnapshot:{...report.buildSnapshot,applicationVersion:bad}}:report);
    assert.notEqual(status,0);
    assert.match(stderr,/application version recorded in cold-smoke\.json is not a version string/);
    assert.equal(heading,null,'no report is written');
  }
});
