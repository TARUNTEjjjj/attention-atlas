import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLOWED_ORIGIN,DEFAULTS,LIMITS,optionsFromArgs,validateOptions,normalizeAssetPaths,createPlan,percentile,summarizeLatencies,SafetyMonitor} from '../scripts/load-model.mjs';

test('load plan: 10,000 HTML navigations are 10,000 paced requests, not 10,000 inflight requests',()=>{
  const plan=createPlan({sessions:10000,rps:100,concurrency:128});
  assert.equal(plan.plannedRequests,10000);assert.equal(plan.minimumLaunchSeconds,99.99);assert.deepEqual(plan.paths,['/']);assert.equal(plan.concurrency,128);
});
test('load plan: cold bundles include one HTML and each unique runtime asset',()=>{
  const plan=createPlan({scenario:'cold',sessions:10,rps:25},{assets:[{path:'/assets/123/src/app.js',sha256:'abc'},'/styles.css','/styles.css','/index.html','/404.html']});
  assert.deepEqual(plan.paths,['/','/assets/123/src/app.js','/styles.css']);assert.equal(plan.plannedRequests,30);assert.equal(plan.minimumLaunchSeconds,29/25);
});
test('load plan: warm mode explicitly declares its unmeasured browser-cache assumption',()=>{
  const plan=createPlan({scenario:'warm'});assert.equal(plan.plannedRequests,100);assert.match(plan.scenarioMeaning,/assumed/);assert.match(plan.scenarioMeaning,/not browser-tested/);
});
test('load safety: only the specific owner-authorized origin is permitted',()=>{
  for(const target of ['http://attention-atlas.pages.dev','https://example.com','https://attention-atlas.pages.dev.evil.test','https://attention-atlas.pages.dev:8443','https://user:secret@attention-atlas.pages.dev','https://attention-atlas.pages.dev/foo','https://attention-atlas.pages.dev/?x=1','https://attention-atlas.pages.dev/#x'])assert.throws(()=>validateOptions({target}));
  assert.equal(validateOptions({target:ALLOWED_ORIGIN+'/'}).target,ALLOWED_ORIGIN);
});
test('load safety: bounded positive integer rates, request concurrency and cohort size',()=>{
  for(const key of ['sessions','rps','concurrency','timeoutSeconds'])for(const value of [0,-1,1.5,NaN,Infinity,1000000])assert.throws(()=>validateOptions({[key]:value}));
  assert.equal(validateOptions({rps:500,concurrency:256,sessions:10000}).concurrency,256);
  assert.throws(()=>validateOptions({rps:501}));assert.throws(()=>validateOptions({concurrency:257}));
  assert.equal(validateOptions({holdSeconds:0}).holdSeconds,0);assert.throws(()=>validateOptions({holdSeconds:61}));
});
test('load safety: total request budget is enforced before network activity',()=>{
  const assets=Array.from({length:30},(_,i)=>`/assets/${i}.js`);
  assert.throws(()=>createPlan({scenario:'cold',sessions:10000}, {assets}),/hard cap/);
});
test('load manifest: rejects remote URLs, traversal, encoded paths and secret/hidden files',()=>{
  for(const path of ['https://example.com/a.js','//example.com/a.js','../x.js','/a/../x.js','/.env','/.git/config','/x%2ejs','/file.js?token=x','/a\\b.js','/wrangler.toml'])assert.throws(()=>normalizeAssetPaths({assets:[path]}));
});
test('load manifest: tab, LF or CR, which the URL parser drops, cannot point a request at another host or path',()=>{
  for(const path of ['/\t/evil.example/a.js','/\n/evil.example/a.js','/\r/evil.example/a.js','\t//evil.example/a.js','/\t/10.0.0.5/a.js','/assets/\t../\t../x.js','/\t.git/config.json'])assert.throws(()=>normalizeAssetPaths({assets:[path]}),/Manifest/,JSON.stringify(path));
  // Whatever is accepted is requested exactly as checked, on the allowed origin.
  for(let code=0;code<128;code++)for(const template of ['/X/evil.example/a.js','X//evil.example/a.js','/assets/X../x.js','/X.git/a.js','/a.jsX']){
    const raw=template.replace('X',()=>String.fromCharCode(code));let paths;
    try{paths=normalizeAssetPaths({assets:[raw]});}catch{continue;}
    for(const path of paths){const url=new URL(path,ALLOWED_ORIGIN);assert.equal(url.origin,ALLOWED_ORIGIN,JSON.stringify(raw));assert.equal(url.pathname,path,JSON.stringify(raw));}
  }
});
test('load manifest: validates shape and limits breadth',()=>{
  for(const x of [null,{},[],{assets:[]},{assets:[{}]}])assert.throws(()=>normalizeAssetPaths(x));
  assert.throws(()=>normalizeAssetPaths({assets:Array.from({length:65},(_,i)=>`/x${i}.js`)}));
});
test('load args: dry-run cannot accidentally be parsed as a network setting',()=>{
  const config=optionsFromArgs(['--dry-run','--sessions','10000','--rps','100','--hold-seconds','0']);
  assert.equal(config.dryRun,true);assert.equal(config.sessions,10000);assert.equal(config.rps,100);assert.equal(config.holdSeconds,0);
  assert.deepEqual(optionsFromArgs(['--help']),{help:true});
});
test('load args: misspelled flags and missing values fail closed',()=>{
  for(const args of [['--session','100'],['--sessions'],['sessions','10'],['--sessions','abc'],['--scenario','unbounded']])assert.throws(()=>optionsFromArgs(args));
});
test('percentiles: nearest-rank p95 and p99 retain outliers without mutating inputs',()=>{
  const data=[...Array.from({length:98},(_,i)=>i+1),1000,2000].reverse();const copy=[...data];
  assert.equal(percentile(data,.5),50);assert.equal(percentile(data,.95),95);assert.equal(percentile(data,.99),1000);assert.deepEqual(data,copy);
  assert.equal(percentile([], .95),null);assert.throws(()=>percentile([1],1.1));
});
test('latency summary: maximum is safe at the full 200,000-request cap',()=>{
  const summary=summarizeLatencies(Array.from({length:LIMITS.requests},(_,i)=>i));
  assert.equal(summary.samples,200000);assert.equal(summary.maxMs,199999);assert.equal(summary.p95Ms,189999);assert.equal(summarizeLatencies([]).maxMs,null);
});
const ok=(durationMs=100)=>({ok:true,status:200,durationMs});
const fail=()=>({ok:false,status:500,durationMs:100});
test('load guardrail: rate-limit, access denial and challenge responses stop immediately',()=>{
  for(const sample of [{...ok(),status:429},{...ok(),status:403},{...ok(),challenge:true}])assert.match(new SafetyMonitor().record(sample),/Immediate stop/);
});
test('load guardrail: exactly one failure per 100 does not exceed the 1% rule',()=>{
  const monitor=new SafetyMonitor();assert.equal(monitor.record(fail()),null);
  for(let i=0;i<99;i++)assert.equal(monitor.record(ok()),null);
});
test('load guardrail: two failures within a rolling 100 stop the run',()=>{
  const monitor=new SafetyMonitor();monitor.record(fail());for(let i=0;i<98;i++)assert.equal(monitor.record(ok()),null);
  assert.match(monitor.record(fail()),/More than 1%/);
});
test('load guardrail: five consecutive errors stop without waiting for 100 samples',()=>{
  const monitor=new SafetyMonitor();for(let i=0;i<4;i++)assert.equal(monitor.record(fail()),null);assert.match(monitor.record(fail()),/Five consecutive/);
});
test('load guardrail: a healthy response resets the consecutive-error streak',()=>{
  const monitor=new SafetyMonitor();for(let j=0;j<4;j++){for(let i=0;i<4;i++)assert.equal(monitor.record(fail()),null);assert.equal(monitor.record(ok()),null);}
});
test('load guardrail: only sustained two-window p95 latency above 5s stops',()=>{
  const monitor=new SafetyMonitor();for(let i=0;i<199;i++)assert.equal(monitor.record(ok(5001)),null);assert.match(monitor.record(ok(5001)),/two consecutive/);
  const recovered=new SafetyMonitor();for(let i=0;i<100;i++)assert.equal(recovered.record(ok(5001)),null);for(let i=0;i<100;i++)assert.equal(recovered.record(ok()),null);for(let i=0;i<100;i++)assert.equal(recovered.record(ok(5001)),null);
});

test('load wall-time: defaults to 900 seconds and cannot exceed 1800',()=>{
  assert.equal(validateOptions({}).maxSeconds,900);
  assert.equal(optionsFromArgs(['--max-seconds','1800']).maxSeconds,1800);
  for(const maxSeconds of [0,-1,1.5,NaN,Infinity,1801])assert.throws(()=>validateOptions({maxSeconds}));
});
test('load wall-time: impossible paced workloads are refused before sending traffic',()=>{
  assert.throws(()=>createPlan({sessions:10000,rps:1,maxSeconds:900}),/exceeds maxSeconds/);
  assert.throws(()=>createPlan({sessions:1000,rps:100,maxSeconds:20,holdSeconds:15}),/exceeds maxSeconds/);
  assert.equal(createPlan({sessions:1000,rps:100,maxSeconds:25,holdSeconds:15}).plannedRequests,1000);
});

// Exercise the complete executable without network access. The child process
// replaces https.request before importing the runner; all responses are local fixtures.
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
async function fixtureRun(status,manifest={version:1,release:'fixture123',applicationVersion:'1.2.0',assets:[]}) {
  const dir=await mkdtemp(join(tmpdir(),'atlas-load-fixture-'));
  try {
    await mkdir(join(dir,'scripts'));await mkdir(join(dir,'dist'));
    for(const file of ['load-test.mjs','load-model.mjs'])await writeFile(join(dir,'scripts',file),await readFile(new URL(`../scripts/${file}`,import.meta.url)));
    await writeFile(join(dir,'dist','index.html'),'<!doctype html><title>Attention Atlas test fixture</title>');
    await writeFile(join(dir,'dist','asset-manifest.json'),JSON.stringify(manifest));
    const output=join(dir,'report.json');
    const code=`
      import https from 'node:https';
      import {EventEmitter} from 'node:events';
      import {readFileSync} from 'node:fs';
      import {gzipSync} from 'node:zlib';
      const body=gzipSync(readFileSync(${JSON.stringify(join(dir,'dist','index.html'))}));
      let requests=0;
      https.request=(url,options,callback)=>{
        requests++;
        if(url.origin!=='https://attention-atlas.pages.dev')throw new Error('Unexpected target');
        const req=new EventEmitter();req.destroy=error=>queueMicrotask(()=>req.emit('error',error));
        req.end=()=>queueMicrotask(()=>{
          const res=new EventEmitter();res.statusCode=${status};res.headers={'content-encoding':'gzip','cf-cache-status':'HIT','cf-ray':'fixture-BOM'};res.destroy=()=>{};
          callback(res);if(${status}===200){res.emit('data',body);res.emit('end');}
        });return req;
      };
      process.argv=['node','fixture','--sessions','1','--rps','100','--concurrency','1','--hold-seconds','0','--output',${JSON.stringify(output)}];
      await import(${JSON.stringify(pathToFileURL(join(dir,'scripts','load-test.mjs')).href)});
      if(requests!==1)throw new Error('Unexpected fixture request count');
    `;
    const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:10000});
    if(child.error)throw child.error;
    const report=JSON.parse(await readFile(output,'utf8'));
    return {status:child.status,stdout:child.stdout,stderr:child.stderr,report};
  } finally {await rm(dir,{recursive:true,force:true});}
}
test('load executable: gzip body validation, release provenance and report work without remote traffic',async()=>{
  const result=await fixtureRun(200);
  assert.equal(result.status,0,result.stderr);assert.equal(result.report.outcome,'completed');
  assert.equal(result.report.http.successful,1);assert.equal(result.report.http.peakInflight,1);assert.equal(result.report.http.encodingCounts.gzip,1);
  assert.equal(result.report.sessions.completedScenarioSessions,1);assert.equal(result.report.sessions.loadLatency.samples,1);
  assert.equal(result.report.buildSnapshot.release,'fixture123');assert.equal(result.report.buildSnapshot.applicationVersion,'1.2.0');assert.equal(result.report.buildSnapshot.manifestSha256.length,64);
  assert.equal(result.report.topology.realBrowsers,0);assert.match(result.stdout,/"event":"finished"/);
});
test('load executable: a manifest from a build before application versions were recorded leaves the version null, not guessed',async()=>{
  const result=await fixtureRun(200,{version:1,release:'fixture123',assets:[]});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.report.buildSnapshot.release,'fixture123');
  assert.equal(result.report.buildSnapshot.applicationVersion,null);
});
test('load executable: denial stops and records a failure without any retry',async()=>{
  const result=await fixtureRun(403);
  assert.equal(result.status,1);assert.equal(result.report.outcome,'stopped');assert.match(result.report.stopReason,/HTTP 403/);
  assert.equal(result.report.http.started,1);assert.equal(result.report.http.failed,1);assert.equal(result.report.sessions.completedScenarioSessions,0);
});
