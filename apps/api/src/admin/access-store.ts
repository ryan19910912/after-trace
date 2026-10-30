import { sql } from 'drizzle-orm';
import { createDatabase } from '../db/client';
import { allAdminPermissions } from './permissions';
export type DbAdminEnv = { DATABASE_URL: string; ADMIN_SESSION_SECRET?: string; ADMIN_PASSWORD_PEPPER?: string };
export type DatabaseAdminIdentity = { id: number; username: string; roleId: string; roleName: string; isSuperAdmin: boolean; permissions: string[]; mustChangePassword: boolean; tokenVersion: number };
const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const bytes = (value: string) => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0));
function secret(value: string | undefined) { if (!value || value.length < 32) throw new Error('ADMIN_SECRET_NOT_CONFIGURED'); return value; }
async function hmac(value: Uint8Array, keyText: string) { const key = await crypto.subtle.importKey('raw', encoder.encode(keyText).buffer as ArrayBuffer, {name:'HMAC',hash:'SHA-256'},false,['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC',key,value.buffer as ArrayBuffer)); }
export function randomAdminPassword() { return b64(crypto.getRandomValues(new Uint8Array(24))); }
export function validAdminPassword(password: unknown): password is string { return typeof password === 'string' && password.length >= 12 && password.length <= 128; }
export async function hashAdminPassword(password: string, pepper: string, salt = crypto.getRandomValues(new Uint8Array(16))): Promise<string> {
  const prehash = await hmac(encoder.encode(password),secret(pepper));
  const key = await crypto.subtle.importKey('raw',prehash.buffer as ArrayBuffer,'PBKDF2',false,['deriveBits']);
  const result = await crypto.subtle.deriveBits({name:'PBKDF2',salt:salt.buffer as ArrayBuffer,iterations:100000,hash:'SHA-256'},key,256);
  return 'pbkdf2-sha256$100000$'+b64(salt)+'$'+b64(new Uint8Array(result));
}
export async function verifyAdminPassword(password: string, stored: string, pepper: string): Promise<boolean> {
  const parts = stored.split('$'); if(parts.length!==4||parts[0]!=='pbkdf2-sha256'||parts[1]!=='100000')return false;
  try { const actual=(await hashAdminPassword(password,pepper,bytes(parts[2]))).split('$')[3];const a=encoder.encode(actual),b=encoder.encode(parts[3]);let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a[i]??0)^(b[i]??0);return diff===0; } catch {return false;}
}
function identity(row: Record<string, unknown>): DatabaseAdminIdentity {
  return {id:Number(row.id),username:String(row.username),roleId:String(row.role_id),roleName:String(row.role_name),isSuperAdmin:row.is_super_admin===true,permissions:row.is_super_admin===true?allAdminPermissions:Array.isArray(row.permissions)?row.permissions.filter((p):p is string=>typeof p==='string'&&allAdminPermissions.includes(p)):[],mustChangePassword:row.must_change_password===true,tokenVersion:Number(row.token_version)};
}
export async function authenticateDatabaseAdmin(username: string, password: string, env: DbAdminEnv): Promise<DatabaseAdminIdentity | null> {
  const db=createDatabase(env.DATABASE_URL);const name=username.trim().toLowerCase();
  const result=await db.execute(sql`SELECT a.*,r.name AS role_name,r.permissions FROM worklog_admin_accounts a JOIN worklog_admin_roles r ON r.id=a.role_id WHERE a.username=${name} LIMIT 1`);
  const row=result.rows[0];
  // A dummy KDF also runs for unknown users, so login does not skip password work.
  const dummy='pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const valid=await verifyAdminPassword(password,String(row?.password_hash??dummy),secret(env.ADMIN_PASSWORD_PEPPER));
  if(!row||row.active!==true)return null;
  if(row.locked_until&&new Date(String(row.locked_until)).getTime()>Date.now())return null;
  if(!valid){await db.execute(sql`UPDATE worklog_admin_accounts SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts+1>=5 THEN NOW()+INTERVAL '10 minutes' ELSE locked_until END WHERE id=${Number(row.id)}`);return null;}
  const changed=await db.execute(sql`UPDATE worklog_admin_accounts SET failed_attempts=0,locked_until=NULL,last_login_at=NOW() WHERE id=${Number(row.id)} AND active=TRUE AND token_version=${Number(row.token_version)} AND password_hash=${String(row.password_hash)} AND (locked_until IS NULL OR locked_until<=NOW()) RETURNING id`);
  return changed.rows.length?identity(row):null;
}
export async function issueDatabaseAdminSession(username: string, env: DbAdminEnv, now=new Date(), ttlSeconds=43200): Promise<string> {
  if(!Number.isSafeInteger(ttlSeconds)||ttlSeconds<60||ttlSeconds>86400)throw new Error('ADMIN_SESSION_TTL_INVALID');
  const result=await createDatabase(env.DATABASE_URL).execute(sql`SELECT id,token_version FROM worklog_admin_accounts WHERE username=${username.toLowerCase()} AND active=TRUE LIMIT 1`);const row=result.rows[0];if(!row)throw new Error('ADMIN_IDENTITY_INVALID');
  const payload=b64(encoder.encode(JSON.stringify({type:'DATABASE_ADMIN_SESSION',id:Number(row.id),version:Number(row.token_version),expiresAt:Math.floor(now.getTime()/1000)+ttlSeconds,nonce:randomAdminPassword()})));
  return payload+'.'+b64(await hmac(encoder.encode(payload),secret(env.ADMIN_SESSION_SECRET)));
}
export async function verifyDatabaseAdminSession(token: string, env: DbAdminEnv, now=new Date()): Promise<DatabaseAdminIdentity|null> {
  let id: number, version: number;
  try {
    const parts=token.split('.');if(parts.length!==2)return null;
    const signature=await hmac(encoder.encode(parts[0]),secret(env.ADMIN_SESSION_SECRET)),supplied=bytes(parts[1]);let diff=signature.length^supplied.length;for(let i=0;i<signature.length;i++)diff|=signature[i]^(supplied[i]??0);if(diff)return null;
    const claims=JSON.parse(new TextDecoder().decode(bytes(parts[0])));
    if(claims.type!=='DATABASE_ADMIN_SESSION'||!Number.isSafeInteger(claims.id)||claims.id<1||!Number.isSafeInteger(claims.version)||!Number.isSafeInteger(claims.expiresAt)||claims.expiresAt<=Math.floor(now.getTime()/1000))return null;
    id=claims.id;version=claims.version;
  } catch { return null; }
  // Database failures propagate as unavailable, rather than falsely expiring valid sessions.
  const result=await createDatabase(env.DATABASE_URL).execute(sql`SELECT a.id,a.username,a.role_id,a.is_super_admin,a.must_change_password,a.token_version,r.name AS role_name,r.permissions FROM worklog_admin_accounts a JOIN worklog_admin_roles r ON r.id=a.role_id WHERE a.id=${id} AND a.active=TRUE AND a.token_version=${version} LIMIT 1`);
  return result.rows[0]?identity(result.rows[0]):null;
}
