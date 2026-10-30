import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const target=process.argv[2];
if(!['api','web','admin'].includes(target))throw new Error('Usage: node scripts/integration/dev.mjs api|web|admin');
if(!existsSync('.test-artifacts/wrangler.integration.json'))throw new Error('Run pnpm integration:configure first');
const args=target==='api'
 ? [resolve('apps/api/node_modules/wrangler/bin/wrangler.js'),'dev','--config',resolve('.test-artifacts/wrangler.integration.json'),'--local']
 : [resolve(`apps/${target}/node_modules/vite/bin/vite.js`),'--host','127.0.0.1','--port',target==='web'?'15173':'15174','--strictPort'];
const result=spawnSync(process.execPath,args,{cwd:target==='api'?process.cwd():resolve('apps',target),env:{...process.env,VITE_API_BASE_URL:'http://localhost:18787'},stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status??1);
