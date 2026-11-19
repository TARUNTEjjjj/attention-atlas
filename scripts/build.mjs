import {rm,mkdir,copyFile,readdir,readFile,writeFile,stat,lstat} from 'node:fs/promises';
import {resolve,dirname,relative,sep,isAbsolute,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readAppRelease,stampAppVersion,writeAppVersion} from './app-release.mjs';
import {stageResourceExplorer,readResourceExplorerInputs,stageRootOfflineWorker,publicResourceFiles} from './stage-resource-explorer.mjs';
const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Semantic version, with optional pre-release and build metadata. Nothing else can reach a manifest or a report.
export const validApplicationVersion=version=>typeof version==='string'&&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)&&version.length<=64;
const digest=data=>createHash('sha256').update(data).digest('hex');
async function list(dir){const result=[];for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=resolve(dir,e.name);result.push(...e.isDirectory()?await list(p):[p]);}return result;}
// What the pages load, and nothing else: the stylesheets, icon and scripts the two pages link (the references the build
// rewrites below), then every file under src/ that one of those names by a relative path, as an import, a stylesheet's
// @import or a url() does. A backup, a copy or a draft left in src/ is named by none of them, whatever it is called, so
// it stays out of the release, its ID, the app version and the public asset manifest.
async function pageSources(root){
 const found=new Set(),queue=[];
 for(const page of ['index.html','404.html'])for(const [,path] of (await readFile(resolve(root,page),'utf8')).matchAll(/(?:href|src)="\/(styles\.css|favicon\.svg|src\/[^"?#]+)"/g))queue.push(path);
 for(const path of queue){
  if(found.has(path))continue;
  found.add(path);
  const references=/\.m?js$/.test(path)?/(['"`])(\.\.?\/[^'"`\s]+)\1/g:path.endsWith('.css')?/(?:@import\s+(?:url\(\s*)?|url\(\s*)(['"]?)([^'")\s]+)\1/g:null;
  if(!references)continue;
  for(const [,,reference] of (await readFile(resolve(root,path),'utf8')).matchAll(references)){
   const target=posix.join(posix.dirname(path),reference.replace(/[?#].*$/,''));
   if(!target.startsWith('src/'))continue; // a path that leaves src/ is not this build's to ship
   const entry=await stat(resolve(root,target)).catch(()=>null);
   // A folder, or a path with ${…} in it, is put together as the module runs, so nothing here says which files it needs.
   // Stop rather than publish a release that is missing them.
   if(entry?.isDirectory()||reference.includes('${'))throw new Error(`${path} builds the path of what it loads from ${reference} as it runs; name each file in full so the build can ship it`);
   if(entry?.isFile())queue.push(target); // a quoted "./name" in prose that is not a file names nothing
  }
 }
 return [...found].sort();
}
export async function buildSite({root=projectRoot,outDir=resolve(root,'dist')}={}){
 root=resolve(root);outDir=resolve(outDir);
 const outputPath=relative(root,outDir);
 if(!outputPath||outputPath==='..'||outputPath.startsWith('..'+sep)||isAbsolute(outputPath))throw new Error('Build directory must be a child of the project root');
 // Reject source overlap and symlink ancestors before any recursive removal.
 const protectedPaths=['offline-resources-worker.js','resources','src','scripts','tests','docs','.git','.github','index.html','404.html','_headers','styles.css','favicon.svg','package.json','README.md'];
 const foldedPath=outputPath.toLowerCase();
 if(protectedPaths.some(path=>foldedPath===path.toLowerCase()||foldedPath.startsWith(path.toLowerCase()+sep)||path.toLowerCase().startsWith(foldedPath+sep)))throw new Error('Build directory overlaps protected project files');
 let ancestor=root;
 for(const part of outputPath.split(sep)){
  ancestor=resolve(ancestor,part);
  try{const entry=await lstat(ancestor);if(entry.isSymbolicLink())throw new Error('Build directory cannot contain symbolic links');if(!entry.isDirectory())throw new Error('Build directory cannot replace an existing file');}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 // The human-readable application version (package.json "version") travels with the release in the public manifest, so a
 // workload report can say which version it measured. It names the release; it is not part of the release ID.
 const applicationVersion=JSON.parse(await readFile(resolve(root,'package.json'),'utf8')).version;
 if(!validApplicationVersion(applicationVersion))throw new Error('package.json must give a version such as 1.2.0');
 const sourcePaths=await pageSources(root);
 const sources=await Promise.all(sourcePaths.map(async path=>({path,data:await readFile(resolve(root,path))})));
 // The app version covers the same files, named one by one, so a stray file in src/ or resources/ cannot change it. From
 // resources/ that is the library's public files, the ones staged below; readAppRelease leaves out catalog.json, whose
 // refreshes are not app releases.
 const appRelease=await readAppRelease(root,{project:'attention-atlas',sourcePaths:['index.html','404.html','_headers',...sourcePaths,...publicResourceFiles.map(file=>'resources/'+file),'offline-resources-worker.js','scripts/build.mjs','scripts/app-release.mjs','scripts/app-update-protocol.mjs','scripts/stage-resource-explorer.mjs']});
 const resourceInputs=[...await readResourceExplorerInputs(root,{release:appRelease})].map(([file,data])=>({path:'resources/'+file,data}));
 const releaseInputs=[...sources,...resourceInputs,...await Promise.all(['index.html','404.html','_headers','offline-resources-worker.js'].map(async path=>({path,data:await readFile(resolve(root,path))})))];
 const release=digest(Buffer.concat(releaseInputs.flatMap(s=>[Buffer.from(s.path+'\0'),s.data,Buffer.from('\0')]))).slice(0,16);
 // Only this explicitly selected build directory is removed; never the source checkout.
 if(resolve(outDir)===resolve(root)||relative(resolve(root),resolve(outDir)).startsWith('..'))throw new Error('Build directory must be a child of the project root');
 await rm(outDir,{recursive:true,force:true});await mkdir(outDir,{recursive:true});
 const prefix=`/assets/${release}/`,assets=[];
 for(const {path,data} of sources){const target=resolve(outDir,'assets',release,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,data);assets.push({path:prefix+path,bytes:data.length,sha256:digest(data)});}
 for(const page of ['index.html','404.html']){
  let html=stampAppVersion(await readFile(resolve(root,page),'utf8'),appRelease);
  html=html.replace(/(href|src)="\/(styles\.css|favicon\.svg|src\/[^"?#]+)"/g,(_,attr,path)=>`${attr}="${prefix}${path}"`);
  html=html.replace('</head>',`<meta name="atlas-release" content="${release}"></head>`);
  await writeFile(resolve(outDir,page),html);
 }
 await copyFile(resolve(root,'_headers'),resolve(outDir,'_headers'));
 await stageResourceExplorer(root,resolve(outDir,'resources'),{release:appRelease});
 await stageRootOfflineWorker(root,outDir,{release:appRelease});
 await writeAppVersion(outDir,appRelease,{workers:[{scope:'/',script:'/offline-resources-worker.js'},{scope:'/resources/',script:'/resources/offline-worker.js'}]});
 const manifest={version:1,release,applicationVersion,assets};
 await writeFile(resolve(outDir,'asset-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const all=await list(outDir);const bytes=(await Promise.all(all.map(p=>stat(p)))).reduce((sum,s)=>sum+s.size,0);
 if(bytes>350000)throw new Error(`Static build exceeds 350 KB performance budget: ${bytes} bytes`);
 console.log(`Built release ${release} (version ${applicationVersion}): ${assets.length} immutable assets; ${bytes} bytes total. All lab calculations run on the learner's device.`);
 return {release,applicationVersion,assets,bytes};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildSite();
