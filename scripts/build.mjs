import {rm,mkdir,copyFile,readdir,readFile,writeFile,stat,lstat} from 'node:fs/promises';
import {resolve,dirname,relative,sep,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readAppRelease,stampAppVersion,writeAppVersion} from './app-release.mjs';
import {stageResourceExplorer,readResourceExplorerInputs,stageRootOfflineWorker} from './stage-resource-explorer.mjs';
const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const digest=data=>createHash('sha256').update(data).digest('hex');
async function list(dir){const result=[];for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=resolve(dir,e.name);result.push(...e.isDirectory()?await list(p):[p]);}return result;}
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
 const sourcePaths=['styles.css','favicon.svg',...(await list(resolve(root,'src'))).map(p=>relative(root,p))].sort();
 const sources=await Promise.all(sourcePaths.map(async path=>({path,data:await readFile(resolve(root,path))})));
 const appRelease=await readAppRelease(root,{project:'attention-atlas',sourcePaths:['index.html','404.html','_headers','styles.css','favicon.svg','src','resources','offline-resources-worker.js','scripts/build.mjs','scripts/app-release.mjs','scripts/app-update-protocol.mjs','scripts/stage-resource-explorer.mjs'],ignorePaths:['resources/README.md','resources/sources.json']});
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
 const manifest={version:1,release,assets};
 await writeFile(resolve(outDir,'asset-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const all=await list(outDir);const bytes=(await Promise.all(all.map(p=>stat(p)))).reduce((sum,s)=>sum+s.size,0);
 if(bytes>350000)throw new Error(`Static build exceeds 350 KB performance budget: ${bytes} bytes`);
 console.log(`Built release ${release}: ${assets.length} immutable assets; ${bytes} bytes total. All lab calculations run on the learner's device.`);
 return {release,assets,bytes};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildSite();
