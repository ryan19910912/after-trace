import { randomBytes, createHmac, pbkdf2Sync } from 'node:crypto';
import{readFileSync,writeFileSync,existsSync}from'node:fs';
export function accessSeedStatements(root, pepper) {
  if(!pepper||pepper.length<32)throw Error('ADMIN_PASSWORD_PEPPER is required');
  const pages=JSON.parse(readFileSync(root+'/config/admin-pages.json','utf8'));const models=JSON.parse(readFileSync(root+'/config/local-ai-models.seed.json','utf8'));
  const quote=v=>"'"+String(v).replaceAll("'","''")+"'";const all=pages.flatMap(p=>p.permissions);const operator=['errors.read','users.read','users.history','ai_prompts.read','ai_models.read','feedback.read','feedback.write','announcements.read','announcements.write'];
  const password=randomBytes(24).toString('base64url');const salt=randomBytes(16);const prehash=createHmac('sha256',pepper).update(password).digest();const hash='pbkdf2-sha256$100000$'+salt.toString('base64url')+'$'+pbkdf2Sync(prehash,salt,100000,32,'sha256').toString('base64url');
  const vision=models.find(m=>m.kind==='vision'),speech=models.find(m=>m.kind==='speech'),fallback=models.find(m=>m.id==='onnx-community/whisper-large-v3-turbo');
  return {password,statements:[`INSERT INTO worklog_admin_roles(id,name,permissions) VALUES ('MANAGER','管理者',${quote(JSON.stringify(all))}::jsonb),('OPERATOR','營運者',${quote(JSON.stringify(operator))}::jsonb) ON CONFLICT(id) DO NOTHING;`,
    `INSERT INTO worklog_admin_accounts(username,password_hash,role_id,is_super_admin,must_change_password) VALUES ('admin',${quote(hash)},'MANAGER',TRUE,FALSE) ON CONFLICT(username) DO NOTHING RETURNING id;`,
    `INSERT INTO worklog_local_ai_models(id,vision_model,vision_revision,speech_model,speech_revision,speech_fallback_model,speech_fallback_revision,updated_by) VALUES (1,${quote(vision.id)},${quote(vision.revision)},${quote(speech.id)},${quote(speech.revision)},${quote(fallback.id)},${quote(fallback.revision)},'initial-seed') ON CONFLICT(id) DO NOTHING;`]};
}
export function saveBootstrapPassword(path,password){if(existsSync(path))throw Error('Refusing to overwrite existing bootstrap password receipt');writeFileSync(path,JSON.stringify({username:'admin',password,createdAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});}
