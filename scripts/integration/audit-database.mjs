import {spawnSync} from 'node:child_process';import {writeFileSync} from 'node:fs';
function sql(text){const result=spawnSync('docker',['compose','-f','compose.integration.yaml','exec','-T','postgres','psql','-U','aftertrace','-d','aftertrace','-At','-v','ON_ERROR_STOP=1','-c',text],{encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr);return result.stdout.trim();}
const source=Number(sql("WITH u AS (INSERT INTO worklog_users(display_name) VALUES ('Local performance fixture') RETURNING id), w AS (INSERT INTO worklog_workspaces(owner_user_id,name) SELECT id,'Performance fixture' FROM u RETURNING id,owner_user_id), s AS (INSERT INTO worklog_sources(workspace_id,type,private_user_id,created_by_user_id) SELECT id,'PRIVATE',owner_user_id,owner_user_id FROM w RETURNING id) SELECT id FROM s"));
sql(`INSERT INTO worklog_records(source_id,input_type,raw_text,title,search_terms,ai_enrichment_status,status,version,created_at,updated_at) SELECT ${source},'TEXT','Synthetic performance record '||n,'Benchmark '||n,'[]'::jsonb,'NONE','ACTIVE',1,NOW()-n*interval '1 minute',NOW() FROM generate_series(1,10000) AS n`);
sql('ANALYZE worklog_records');
const query=`SELECT id,raw_text FROM worklog_records WHERE source_id=${source} AND status='ACTIVE' ORDER BY COALESCE(occurred_at,created_at) DESC,id DESC LIMIT 10`;
const before=sql('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query);
// Experiment only: index creation is rolled back. No production schema change.
const after=sql(`BEGIN; CREATE INDEX audit_record_sort_experiment ON worklog_records(source_id,status,COALESCE(occurred_at,created_at) DESC,id DESC); EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query}; ROLLBACK;`);
writeFileSync('.test-artifacts/audit/database-plan.json',JSON.stringify({source,syntheticRecords:10000,before:JSON.parse(before),after,experimentalIndexRolledBack:true},null,2));console.log(before);console.log(after);
