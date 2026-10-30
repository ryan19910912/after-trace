import{readFileSync}from'node:fs';import{spawnSync}from'node:child_process';import{promptSeedStatements}from'../local-prompt-seed.mjs';
const config=JSON.parse(readFileSync('.test-artifacts/wrangler.integration.json','utf8'));if(!['127.0.0.1','localhost'].includes(new URL(config.vars.DATABASE_URL).hostname))throw Error('Local Docker only');
const definitions=JSON.parse(readFileSync('config/local-ai-prompts.seed.json','utf8'));
const r=spawnSync('docker',['compose','-f','compose.integration.yaml','exec','-T','postgres','psql','-U','aftertrace','-d','aftertrace','-v','ON_ERROR_STOP=1'],{input:promptSeedStatements(definitions).join('\n'),encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);console.log('Local prompt defaults seeded; existing edits preserved.');
