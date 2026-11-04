import { rm, mkdir, cp, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist);
for (const path of ['index.html','styles.css','favicon.svg','_headers','404.html','src']) {
  await cp(resolve(root,path), resolve(dist,path), { recursive:true });
}
async function total(dir) { let bytes=0; for(const entry of await readdir(dir,{withFileTypes:true})) { const path=resolve(dir,entry.name); bytes+=entry.isDirectory()?await total(path):(await stat(path)).size; } return bytes; }
console.log(`Built static site: ${await total(dist)} bytes. No runtime dependencies or external API calls.`);
