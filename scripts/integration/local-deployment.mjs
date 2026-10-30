import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const output=resolve(root,'.test-artifacts/local-deployment');
const mode=process.argv[2];
function run(args,cwd=root,env={}){const r=spawnSync(process.execPath,args,{cwd,env:{...process.env,...env},stdio:'inherit'});if(r.status!==0)throw Error('Local build failed: '+args[0]);}
if(mode==='build'){
  mkdirSync(output,{recursive:true});
  for(const name of ['web','admin']){
    const destination=resolve(output,name);if(!destination.startsWith(output+sep))throw Error('Invalid build destination');
    run([resolve(root,`apps/${name}/node_modules/vite/bin/vite.js`),'build','--outDir',destination,'--emptyOutDir'],resolve(root,'apps',name),{VITE_API_BASE_URL:'http://localhost:18787'});
  }
  run([resolve(root,'apps/api/node_modules/wrangler/bin/wrangler.js'),'deploy','--dry-run','--config',resolve(root,'.test-artifacts/wrangler.integration.json'),'--outdir',resolve(output,'api')]);
  const sourceConfig=JSON.parse(readFileSync(resolve(root,'.test-artifacts/wrangler.integration.json'),'utf8'));
  const entry=readdirSync(resolve(output,'api')).find(f=>f.endsWith('.js')&&!f.endsWith('.map'));
  if(!entry)throw Error('Worker build entry missing');
  const config={...sourceConfig,main:'./api/'+entry,no_bundle:true};
  // Secrets stay in the ignored API config, outside both static roots.
  writeFileSync(resolve(output,'wrangler.json'),JSON.stringify(config,null,2));
  const files=[];function walk(folder){for(const name of readdirSync(folder)){const file=resolve(folder,name);if(statSync(file).isDirectory())walk(file);else if(!file.endsWith('.map'))files.push({path:file.slice(output.length+1).replaceAll('\\','/'),sha256:createHash('sha256').update(readFileSync(file)).digest('hex')});}}
  for(const folder of ['web','admin','api'])walk(resolve(output,folder));
  const manifest={buildId:createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0,16),createdAt:new Date().toISOString(),files};
  writeFileSync(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2));
  console.log('LOCAL BUILD READY',manifest.buildId);process.exit(0);
}
if(mode==='api'){
  run([resolve(root,'apps/api/node_modules/wrangler/bin/wrangler.js'),'dev','--config',resolve(output,'wrangler.json'),'--local','--no-bundle']);process.exit(0);
}
if(mode!=='web'&&mode!=='admin')throw Error('Usage: local-deployment.mjs build|web|admin|api');
const staticRoot=realpathSync(resolve(output,mode));const manifest=JSON.parse(readFileSync(resolve(output,'manifest.json'),'utf8'));
const webRoutes=['/','/capture','/tasks','/ai-search','/ai-tools','/ai-task','/subscription','/feedback','/help','/about','/mobile-shortcut','/worklog','/login','/extension/connect'];
const adminRoutes=['/','/error-logs','/users','/ai','/feedback-management','/announcements','/roles','/permissions','/admin-accounts','/accounts','/ai-prompts','/ai-runtime','/commercial','/pricing-calculator','/profitability'];
const routes=new Set(mode==='web'?webRoutes:adminRoutes);
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2'};
http.createServer((req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Aftertrace-Build',manifest.buildId);
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});return res.end();}
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);return res.end();}
  if(pathname==='/__local-build'){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');return res.end(req.method==='HEAD'?undefined:JSON.stringify({buildId:manifest.buildId,createdAt:manifest.createdAt,component:mode,productionBuild:true}));}
  let file=routes.has(pathname)?resolve(staticRoot,'index.html'):resolve(staticRoot,'.'+pathname);
  if(!file.startsWith(staticRoot+sep)||!existsSync(file)){res.writeHead(404);return res.end('Not found');}
  try{file=realpathSync(file);if(!file.startsWith(staticRoot+sep)||!statSync(file).isFile()||!types[extname(file)])throw Error('Outside static root');}catch{res.writeHead(404);return res.end('Not found');}
  res.setHeader('Content-Type',types[extname(file)]);res.setHeader('Cache-Control',file.includes(sep+'assets'+sep)?'public, max-age=31536000, immutable':'no-cache');
  if(req.method==='HEAD')return res.end();createReadStream(file).on('error',()=>res.destroy()).pipe(res);
}).listen(mode==='web'?15173:15174,'127.0.0.1',()=>console.log(`Local ${mode} production build ${manifest.buildId} ready`));
