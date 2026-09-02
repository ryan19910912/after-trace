import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { verifyWebSessionToken } from '../auth/token';
import { createDatabase } from '../db/client';

type Bindings={DATABASE_URL:string;WEB_AUTH_SECRET?:string;WEB_APP_ORIGIN?:string};
type Env={Bindings:Bindings};

export function createWorklogFeedbackRoutes(){
  const app=new Hono<Env>();
  app.post('/',async c=>{
    const origin=c.req.header('origin');const allowed=c.env.WEB_APP_ORIGIN?.trim();
    if(origin&&(!allowed||origin!==allowed))return c.json({ok:false,error:'ORIGIN_NOT_ALLOWED'},403);
    if(origin&&allowed===origin){c.header('Access-Control-Allow-Origin',origin);c.header('Vary','Origin');}
    const secret=c.env.WEB_AUTH_SECRET?.trim();if(!secret||secret.length<32)return c.json({ok:false,error:'WEB_AUTH_NOT_CONFIGURED'},503);
    const auth=c.req.header('authorization')??'';const match=/^Bearer\s+(.+)$/i.exec(auth.trim());if(!match)return c.json({ok:false,error:'WEB_SESSION_REQUIRED'},401);
    const session=await verifyWebSessionToken(match[1],secret);if(!session)return c.json({ok:false,error:'INVALID_WEB_SESSION'},401);
    let body:unknown;try{body=await c.req.json();}catch{return c.json({ok:false,error:'INVALID_JSON'},400);}
    if(!body||typeof body!=='object'||Array.isArray(body))return c.json({ok:false,error:'INVALID_REQUEST'},400);
    const row=body as Record<string,unknown>;const text=typeof row.text==='string'?row.text.trim():'';
    if(!text||text.length>5000)return c.json({ok:false,error:'INVALID_FEEDBACK_TEXT'},400);
    const context=typeof row.context==='object'&&row.context!==null&&!Array.isArray(row.context)?row.context:null;
    const database=createDatabase(c.env.DATABASE_URL);
    const user=await database.execute(sql`SELECT id::text AS id FROM worklog_users WHERE line_user_id=${session.lineUserId} LIMIT 1`);
    const userId=(user.rows[0] as {id?:string}|undefined)?.id;if(!userId)return c.json({ok:false,error:'WORKLOG_USER_NOT_FOUND'},404);
    const result=await database.execute(sql`
      INSERT INTO worklog_feedback (user_id, channel, feedback_text, context, created_at)
      VALUES (${Number(userId)}, 'PWA', ${text}, ${JSON.stringify(context)}::jsonb, NOW())
      RETURNING id::text AS id, created_at
    `);
    return c.json({ok:true,feedback:result.rows[0]},201);
  });
  app.options('/',c=>{const origin=c.req.header('origin');const allowed=c.env.WEB_APP_ORIGIN?.trim();if(!origin||!allowed||origin!==allowed)return c.body(null,403);c.header('Access-Control-Allow-Origin',origin);c.header('Access-Control-Allow-Headers','Authorization, Content-Type');c.header('Access-Control-Allow-Methods','POST, OPTIONS');c.header('Vary','Origin');return c.body(null,204);});
  return app;
}
