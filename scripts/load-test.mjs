#!/usr/bin/env node
/** Owner-authorized, rate-capped HTTP workload. No browser simulation or protection bypass. */
import https from 'node:https';
import {setMaxListeners} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync,brotliDecompressSync,inflateSync} from 'node:zlib';
import {setTimeout as delay} from 'node:timers/promises';
import {monitorEventLoopDelay,performance} from 'node:perf_hooks';
import {optionsFromArgs,createPlan,SafetyMonitor,summarizeLatencies} from './load-model.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const options=optionsFromArgs(process.argv.slice(2));
if(options.help){console.log(`Owner-authorized Attention Atlas HTTP workload\n\nnode scripts/load-test.mjs --scenario html --sessions 10000 --rps 100 --concurrency 128 --hold-seconds 15 --output /tmp/atlas-load.json\n\nScenarios: html = one HTML GET/session; warm = same workload with cached-assets assumption; cold = HTML plus each asset in --manifest (default dist/asset-manifest.json). No JavaScript execution, real browsers, geographic distribution or 10,000 simultaneous HTTP requests is implied.\nUse --dry-run to print the plan without sending requests.\nHard caps: 10,000 sessions, 500 requests/sec, 256 simultaneous requests, 200,000 total requests, 1,800 seconds. Default wall-time budget is 900 seconds; override with --max-seconds. Immediate abort on403/429/challenges; error and slow-response guardrails also apply.\n`);process.exit(0);}
let manifest=null,manifestRaw=null;
try{manifestRaw=await readFile(resolve(root,options.manifest),'utf8');manifest=JSON.parse(manifestRaw);}catch(error){if(options.scenario==='cold'||error.code!=='ENOENT')throw error;}
const plan=createPlan(options,manifest);
if(options.dryRun){console.log(JSON.stringify({dryRun:true,...plan},null,2));process.exit(0);}
const expected=new Map();
for(const path of plan.paths){const filename=path==='/'?'index.html':path.slice(1);const bytes=await readFile(resolve(root,'dist',filename));expected.set(path,createHash('sha256').update(bytes).digest('hex'));}
const agent=new https.Agent({keepAlive:true,maxSockets:plan.concurrency,maxFreeSockets:Math.min(plan.concurrency,32),timeout:30000});
const controller=new AbortController(),safety=new SafetyMonitor(),loop=monitorEventLoopDelay({resolution:20});
loop.enable();
setMaxListeners(plan.concurrency+8,controller.signal);
let stopReason=null,nextSession=0,inflight=0,completedRequests=0,successfulRequests=0,failedRequests=0,cancelledRequests=0;
let sessionsStarted=0,sessionsLoaded=0,sessionsFailed=0,peakInflight=0,nextGrantAt=performance.now(),grantChain=Promise.resolve();
let wireBytes=0,decodedBytes=0,maxRSS=0,firstRequestAt=null,lastRequestAt=null;
const latencies=[],sessionLatencies=[],statusCounts={},cacheCounts={},encodings={},colos={},failures=[],milestones=[],startedBins=new Map(),finishedBins=new Map();
const start=performance.now(),startedAt=new Date().toISOString();
function stop(reason){if(stopReason)return;stopReason=reason;controller.abort(new Error(reason));}
const wallTimer=setTimeout(()=>stop(`Maximum wall time of ${plan.maxSeconds} seconds reached.`),plan.maxSeconds*1000);
process.once('SIGINT',()=>stop('Interrupted by operator (SIGINT).'));
process.once('SIGTERM',()=>stop('Interrupted by operator (SIGTERM).'));
function sampleMemory(){maxRSS=Math.max(maxRSS,process.memoryUsage().rss);}
function bump(map,key){map[key]=(map[key]||0)+1;}
function bumpBin(map,time){const key=Math.floor((time-start)/1000);map.set(key,(map.get(key)||0)+1);}
async function pace(){
  const turn=grantChain.then(async()=>{
    if(controller.signal.aborted)return false;
    const wait=Math.max(0,nextGrantAt-performance.now());
    if(wait)try{await delay(Math.ceil(wait),undefined,{signal:controller.signal});}catch{return false;}
    if(controller.signal.aborted)return false;
    // Do not catch up after event-loop stalls: a delayed grant never causes a burst.
    nextGrantAt=performance.now()+1000/plan.rps;
    return true;
  });
  grantChain=turn.catch(()=>false);return turn;
}
async function request(path){
  const launch=performance.now();firstRequestAt??=launch;bumpBin(startedBins,launch);inflight++;peakInflight=Math.max(peakInflight,inflight);
  return new Promise(resolveResult=>{
    let settled=false,wire=0;
    const finish=(data)=>{if(settled)return;settled=true;clearTimeout(timer);inflight--;lastRequestAt=performance.now();resolveResult({path,durationMs:lastRequestAt-launch,wireBytes:wire,decodedBytes:0,status:0,ok:false,...data});};
    const req=https.request(new URL(path,plan.target),{method:'GET',agent,signal:controller.signal,headers:{'Accept-Encoding':'gzip, br','User-Agent':'AttentionAtlasLoadCheck/1.0 (owner-authorized)','Accept':path==='/'?'text/html':'*/*'}},res=>{
      const status=res.statusCode||0,cache=res.headers['cf-cache-status']||'not-reported',encoding=res.headers['content-encoding']||'identity',ray=String(res.headers['cf-ray']||''),colo=ray.split('-').pop()||'not-reported';
      if(status===403||status===429||res.headers['cf-mitigated']==='challenge'){res.destroy();finish({status,cache,encoding,colo,challenge:res.headers['cf-mitigated']==='challenge',error:`HTTP ${status} / mitigated response`});return;}
      const chunks=[];
      res.on('data',chunk=>{wire+=chunk.length;if(wire>2*1024*1024){res.destroy(new Error('Response exceeded the 2 MiB wire-body limit.'));return;}chunks.push(chunk);});
      res.on('error',error=>finish({status,cache,encoding,colo,error:error.message}));
      res.on('end',()=>{
        try{
          const raw=Buffer.concat(chunks),decompressOptions={maxOutputLength:8*1024*1024};
          const body=encoding==='gzip'?gunzipSync(raw,decompressOptions):encoding==='br'?brotliDecompressSync(raw,decompressOptions):encoding==='deflate'?inflateSync(raw,decompressOptions):raw;
          if(!['gzip','br','deflate','identity'].includes(encoding))throw new Error(`Unsupported response encoding: ${encoding}`);
          const text=path==='/'?body.toString('utf8'):'';
          const challenge=path==='/'&&(/<title>\s*Just a moment/i.test(text)||/cf-chl-|challenge-platform/.test(text));
          const sameBytes=createHash('sha256').update(body).digest('hex')===expected.get(path);
          const ok=status===200&&sameBytes&&!challenge;
          finish({status,cache,encoding,colo,challenge,decodedBytes:body.length,ok,error:ok?null:challenge?'Challenge body received':status!==200?`HTTP ${status}`:'Response differs from the tested local deployment asset'});
        }catch(error){finish({status,cache,encoding,colo,error:error.message});}
      });
    });
    const timer=setTimeout(()=>req.destroy(new Error(`Total request timeout after ${plan.timeoutSeconds}s`)),plan.timeoutSeconds*1000);
    req.on('error',error=>finish({cancelled:controller.signal.aborted,error:error.message}));
    req.end();
  });
}
function record(result){
  completedRequests++;if(completedRequests%100===0)sampleMemory();wireBytes+=result.wireBytes;decodedBytes+=result.decodedBytes;
  bump(statusCounts,String(result.status));bump(cacheCounts,result.cache||'not-reported');bump(encodings,result.encoding||'not-reported');bump(colos,result.colo||'not-reported');
  bumpBin(finishedBins,performance.now());
  if(result.cancelled){cancelledRequests++;return;}
  latencies.push(result.durationMs);
  if(result.ok)successfulRequests++;else{failedRequests++;if(failures.length<20)failures.push(result);}
  const reason=safety.record(result);if(reason)stop(reason);
}
async function worker(){
  while(!controller.signal.aborted){
    const session=nextSession++;if(session>=plan.sessions)return;
    let complete=true,started=false,sessionStart=null;
    for(const path of plan.paths){
      if(!await pace()){complete=false;break;}
      if(!started){started=true;sessionsStarted++;sessionStart=performance.now();}
      const result=await request(path);record(result);
      if(!result.ok){complete=false;break;}
    }
    if(complete){sessionsLoaded++;sessionLatencies.push(performance.now()-sessionStart);if([100,1000,5000,10000,plan.sessions].includes(sessionsLoaded))milestones.push({loadedResidentSessions:sessionsLoaded,elapsedSeconds:(performance.now()-start)/1000,inflightRequests:inflight});}else if(started){sessionsFailed++;}
  }
}
console.log(JSON.stringify({event:'planned',target:plan.target,scenario:plan.scenario,scenarioMeaning:plan.scenarioMeaning,sessions:plan.sessions,requests:plan.plannedRequests,rpsCap:plan.rps,inflightCap:plan.concurrency,minimumLaunchSeconds:plan.minimumLaunchSeconds,residentHoldSeconds:plan.holdSeconds,warning:'Logical resident sessions are modeled; this is not 10,000 real browsers or simultaneous network requests.'}));
const progress=setInterval(()=>{
  sampleMemory();const now=performance.now();
  console.log(JSON.stringify({event:'progress',elapsedSeconds:+((now-start)/1000).toFixed(1),sessionsStarted,loadedResidentSessions:sessionsLoaded,inflightRequests:inflight,successfulRequests,failedRequests,stopReason}));
},10000);
let holdCompleted=false,holdStartedAt=null,holdObservedSeconds=0;
try{
  await Promise.all(Array.from({length:Math.min(plan.concurrency,plan.sessions)},()=>worker()));
  if(!stopReason&&sessionsLoaded===plan.sessions&&plan.holdSeconds){console.log(JSON.stringify({event:'resident-hold',modeledResidentSessions:sessionsLoaded,seconds:plan.holdSeconds,networkRequestsDuringHold:0}));holdStartedAt=performance.now();try{await delay(plan.holdSeconds*1000,undefined,{signal:controller.signal});holdCompleted=true;}catch{}holdObservedSeconds=(performance.now()-holdStartedAt)/1000;}
  else holdCompleted=!stopReason&&sessionsLoaded===plan.sessions;
}finally{
  clearInterval(progress);clearTimeout(wallTimer);sampleMemory();agent.destroy();loop.disable();
}
const end=performance.now(),requestSeconds=firstRequestAt!==null&&lastRequestAt!==null?(lastRequestAt-firstRequestAt)/1000:0;
const report={
  schemaVersion:1,startedAt,finishedAt:new Date().toISOString(),target:plan.target,scenario:plan.scenario,scenarioMeaning:plan.scenarioMeaning,
  outcome:stopReason?'stopped':sessionsLoaded===plan.sessions?'completed':'incomplete',stopReason,
  configuration:{sessions:plan.sessions,paths:plan.paths,plannedRequests:plan.plannedRequests,rpsCap:plan.rps,maxInflightRequests:plan.concurrency,timeoutSeconds:plan.timeoutSeconds,residentHoldSeconds:plan.holdSeconds,maxWallSeconds:plan.maxSeconds},
  buildSnapshot:{release:manifest?.release??null,manifestVersion:manifest?.version??null,manifestSha256:manifestRaw?createHash('sha256').update(manifestRaw).digest('hex'):null,htmlSha256:expected.get('/'),testedAssetDigests:plan.paths.map(path=>({path,sha256:expected.get(path)}))},
  topology:{generators:1,protocol:'HTTP/1.1 with TLS and bounded keep-alive sockets',vantage:'single local host / network path; edge colos reported below',realBrowsers:0,executesClientJavaScript:false,loadsThirdPartyAssets:false,requestBodyValidation:'SHA-256 equality with each corresponding local dist asset'},
  sessions:{started:sessionsStarted,completedScenarioSessions:sessionsLoaded,failedOrCancelledSessions:sessionsFailed,loadLatency:summarizeLatencies(sessionLatencies),loadLatencyMeaning:'Time from the first request launch to validation of the last response in the selected scenario, including per-session pacing waits; no rendering or JavaScript execution.',modeledResidentPeak:sessionsLoaded,residentHoldCompleted:holdCompleted,holdSecondsObserved:holdObservedSeconds,meaning:'Loaded sessions remain logically resident until the final hold finishes. No extra network traffic is generated by their idle residence.'},
  http:{started:[...startedBins.values()].reduce((a,b)=>a+b,0),completed:completedRequests,successful:successfulRequests,failed:failedRequests,cancelled:cancelledRequests,peakInflight,requestPhaseSeconds:requestSeconds,averageRequestsPerSecond:requestSeconds?completedRequests/requestSeconds:0,peakStartsInAlignedSecond:Math.max(0,...startedBins.values()),peakCompletionsInAlignedSecond:Math.max(0,...finishedBins.values()),statusCounts,cacheStatusCounts:cacheCounts,encodingCounts:encodings,edgeColoCounts:colos,wireBodyBytes:wireBytes,decodedBodyBytes:decodedBytes,latency:summarizeLatencies(latencies)},
  generator:{elapsedSeconds:(end-start)/1000,peakSampledResidentSetBytes:maxRSS,memorySampling:'every 100 responses, every 10 seconds and at completion',eventLoopDelayP95Ms:loop.percentile(95)/1e6,eventLoopDelayMaxMs:loop.max/1e6},
  milestones,failures,
  limitations:['This does not establish 10,000 simultaneous TCP/TLS connections, 10,000 browser runtimes, or 10,000 real human visitors.','The static site makes no backend learning API calls. Idle learner concurrency is a workload assumption, not server-side session state.','One network origin cannot establish worldwide latency or a capacity ceiling. The request limiter may be the bottleneck.','Cold mode downloads listed assets sequentially per session and does not execute browser rendering, browser caches, or service workers. HTML/warm modes are not cold full-page loads.','Guardrails intentionally stop before stressing a failing service. Passing this workload is evidence only at the reported request rate and concurrency.']
};
const output=resolve(plan.output);await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({event:'finished',outcome:report.outcome,stopReason,report:output,sessionsLoaded,peakInflight,successfulRequests,failedRequests,p95Ms:report.http.latency.p95Ms,requestPhaseSeconds:requestSeconds,holdCompleted}));
if(report.outcome!=='completed')process.exitCode=1;
