/** Pure planning and safety rules for owner-authorized static-site checks. */
export const ALLOWED_ORIGIN = 'https://attention-atlas.pages.dev';
export const LIMITS = Object.freeze({sessions:10000, rps:500, concurrency:256, requests:200000, holdSeconds:60, maxSeconds:1800});
export const DEFAULTS = Object.freeze({target:ALLOWED_ORIGIN, scenario:'html', sessions:100, rps:25, concurrency:32, holdSeconds:15, timeoutSeconds:15, maxSeconds:900, manifest:'dist/asset-manifest.json', output:'load-report.json'});

export function optionsFromArgs(args) {
  const options = {...DEFAULTS};
  const keys = {'target':'target','scenario':'scenario','sessions':'sessions','rps':'rps','concurrency':'concurrency','hold-seconds':'holdSeconds','timeout-seconds':'timeoutSeconds','max-seconds':'maxSeconds','manifest':'manifest','output':'output'};
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--help')return {help:true};
    if(args[i]==='--dry-run'){options.dryRun=true;continue;}
    const key=keys[args[i].replace(/^--/,'')];
    if(!args[i].startsWith('--')||!key||!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Unknown option or missing value: ${args[i]}`);
    const raw=args[++i];
    options[key]=['sessions','rps','concurrency','holdSeconds','timeoutSeconds','maxSeconds'].includes(key)?Number(raw):raw;
  }
  return validateOptions(options);
}
export function validateOptions(options) {
  const out={...DEFAULTS,...options};
  const target=new URL(out.target);
  if(target.origin!==ALLOWED_ORIGIN||target.pathname!=='/'||target.search||target.hash||target.username||target.password)throw new Error(`Only ${ALLOWED_ORIGIN}/ is an authorized load-test target.`);
  out.target=ALLOWED_ORIGIN;
  for(const [key,max] of [['sessions',LIMITS.sessions],['rps',LIMITS.rps],['concurrency',LIMITS.concurrency],['holdSeconds',LIMITS.holdSeconds],['timeoutSeconds',30],['maxSeconds',LIMITS.maxSeconds]]) {
    const min=key==='holdSeconds'?0:1;
    if(!Number.isSafeInteger(out[key])||out[key]<min||out[key]>max)throw new Error(`${key} must be an integer from ${min} to ${max}.`);
  }
  if(!['html','warm','cold'].includes(out.scenario))throw new Error('scenario must be html, warm, or cold.');
  if(typeof out.output!=='string'||!out.output.trim())throw new Error('output must be a file path.');
  return out;
}
export function normalizeAssetPaths(manifest) {
  const entries=Array.isArray(manifest)?manifest:manifest?.assets;
  if(!Array.isArray(entries)||!entries.length)throw new Error('A cold scenario requires a manifest with an assets array.');
  const paths=['/'];
  for(const entry of entries) {
    const raw=typeof entry==='string'?entry:entry?.path;
    if(typeof raw!=='string'||!raw||raw.includes('\\')||raw.includes('?')||raw.includes('#')||raw.includes('%')||raw.includes(':')||raw.startsWith('//'))throw new Error('Manifest asset paths must be local URL paths.');
    const path=raw.startsWith('/')?raw:`/${raw}`;
    if(path.split('/').some(part=>part==='.'||part==='..')||path.split('/').some(part=>part.startsWith('.')))throw new Error('Manifest traversal and hidden paths are not permitted.');
    if(path==='/index.html'||path==='/')continue;
    if(path==='/404.html'||path==='/_headers'||path==='/asset-manifest.json')continue;
    if(!/\.(?:html|css|js|mjs|svg|png|jpg|jpeg|webp|ico|woff2?|json|webmanifest)$/.test(path))throw new Error(`Unsupported asset path: ${path}`);
    if(!paths.includes(path))paths.push(path);
  }
  if(paths.length>64)throw new Error('A cold bundle is limited to 64 assets.');
  return paths;
}
export function createPlan(options,manifest) {
  const config=validateOptions(options);
  const paths=config.scenario==='cold'?normalizeAssetPaths(manifest):['/'];
  const requests=config.sessions*paths.length;
  if(requests>LIMITS.requests)throw new Error(`Planned requests exceed hard cap ${LIMITS.requests}.`);
  if((requests-1)/config.rps+config.holdSeconds>config.maxSeconds)throw new Error('The minimum paced request time plus residence hold exceeds maxSeconds. Reduce the workload or choose a valid bounded duration/rate.');
  return {...config,paths,plannedRequests:requests,minimumLaunchSeconds:(requests-1)/config.rps,
    scenarioMeaning:config.scenario==='cold'?'Each logical session downloads HTML and every listed deployment asset; this approximates a cold bundle, without executing JavaScript.':config.scenario==='warm'?'Each logical session downloads HTML only; immutable assets are assumed to be in the learner browser cache. Cache behavior is modeled, not browser-tested by this harness.':'Each logical session makes one HTML GET. This is an HTML navigation workload, not a full browser page load.'};
}
export function percentile(values,fraction) {
  if(!values.length)return null;
  if(!Number.isFinite(fraction)||fraction<0||fraction>1)throw new RangeError('Percentile fraction must be between zero and one.');
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.max(0,Math.ceil(sorted.length*fraction)-1)];
}
export function summarizeLatencies(values) {
  if(!values.length)return {samples:0,p50Ms:null,p95Ms:null,p99Ms:null,maxMs:null};
  return {samples:values.length,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),p99Ms:percentile(values,.99),maxMs:values.reduce((max,value)=>Math.max(max,value),-Infinity)};
}
/** Stops are deliberately conservative; this is a capacity check, not a stress-to-failure tool. */
export class SafetyMonitor {
  constructor(){this.recent=[];this.consecutiveErrors=0;this.slowWindows=0;this.window=[];}
  record(sample) {
    if(sample.status===403||sample.status===429||sample.challenge)return `Immediate stop: ${sample.challenge?'challenge response':`HTTP ${sample.status}`}.`;
    this.recent.push(sample);if(this.recent.length>100)this.recent.shift();
    this.consecutiveErrors=sample.ok?0:this.consecutiveErrors+1;
    if(this.consecutiveErrors>=5)return 'Five consecutive failed requests.';
    if(this.recent.length===100&&this.recent.filter(x=>!x.ok).length>1)return 'More than 1% failures in the most recent 100 requests.';
    this.window.push(sample.durationMs);
    if(this.window.length===100){const p95=percentile(this.window,.95);this.slowWindows=p95>5000?this.slowWindows+1:0;this.window=[];if(this.slowWindows>=2)return 'p95 latency exceeded 5 seconds for two consecutive 100-request windows.';}
    return null;
  }
}
