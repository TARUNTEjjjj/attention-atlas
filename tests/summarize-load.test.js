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
  const heading=await readFile(resolve(dir,'docs','CAPACITY.md'),'utf8').then(text=>text.split('\n')[0],error=>{if(error.code!=='ENOENT')throw error;return null;});
  return {status,stderr,heading};
}
async function capacityReport(t,edit){
  const {status,stderr,heading}=await summarize(t,edit);
  assert.equal(status,0,stderr);
  return heading;
}
const measured=release=>report=>({...report,buildSnapshot:{...report.buildSnapshot,release}});

test('capacity report: the heading names the release the reports measured, not a fixed version',async t=>{
  const [committed,rerun,mixed]=await Promise.all([
    capacityReport(t),
    capacityReport(t,measured('dbcdab1bc2bbfa9b')),
    capacityReport(t,(report,name)=>name==='cold-smoke.json'?measured('dbcdab1bc2bbfa9b')(report):report),
  ]);
  assert.equal(committed,'# Measured capacity workload — Attention Atlas release 9369f6aceda5b33c');
  // A later run against another deployment is labelled with that deployment, not with 1.1.
  assert.equal(rerun,'# Measured capacity workload — Attention Atlas release dbcdab1bc2bbfa9b');
  // Reports from two releases name both, rather than one standing for the other.
  assert.equal(mixed,'# Measured capacity workload — Attention Atlas releases 9369f6aceda5b33c, dbcdab1bc2bbfa9b');
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
