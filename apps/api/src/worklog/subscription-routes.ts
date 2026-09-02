import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { verifyWebSessionToken } from '../auth/token';
import { createDatabase } from '../db/client';

type Bindings={DATABASE_URL:string;WEB_AUTH_SECRET?:string;WEB_APP_ORIGIN?:string};
type Env={Bindings:Bindings;Variables:{lineUserId:string}};

export function createWorklogSubscriptionRoutes(){
  const app=new Hono<Env>();
  app.use('*',async(c,next)=>{
    const origin=c.req.header('origin');const allowed=c.env.WEB_APP_ORIGIN?.trim();
    if(origin&&(!allowed||origin!==allowed))return c.json({ok:false,error:'ORIGIN_NOT_ALLOWED'},403);
    await next();c.header('Cache-Control','no-store');
    if(origin&&allowed===origin){c.header('Access-Control-Allow-Origin',origin);c.header('Vary','Origin');}
  });
  app.options('*',c=>{const origin=c.req.header('origin'),allowed=c.env.WEB_APP_ORIGIN?.trim();if(!origin||!allowed||origin!==allowed)return c.body(null,403);c.header('Access-Control-Allow-Origin',origin);c.header('Access-Control-Allow-Headers','Authorization, Content-Type');c.header('Access-Control-Allow-Methods','GET, POST, OPTIONS');c.header('Vary','Origin');return c.body(null,204);});
  app.use('*',async(c,next)=>{const secret=c.env.WEB_AUTH_SECRET?.trim();if(!secret||secret.length<32)return c.json({ok:false,error:'WEB_AUTH_NOT_CONFIGURED'},503);const match=/^Bearer\s+(.+)$/i.exec((c.req.header('authorization')??'').trim());if(!match)return c.json({ok:false,error:'WEB_SESSION_REQUIRED'},401);const session=await verifyWebSessionToken(match[1],secret);if(!session)return c.json({ok:false,error:'INVALID_WEB_SESSION'},401);c.set('lineUserId',session.lineUserId);await next();});

  app.get('/plans',async c=>{
    const db=createDatabase(c.env.DATABASE_URL);
    const user=await userRow(db,c.get('lineUserId'));if(!user)return c.json({ok:false,error:'WORKLOG_USER_NOT_FOUND'},404);
    const result=await db.execute(sql`
      SELECT plan.code, plan.display_name, plan.price_twd::text AS price_twd,
             plan.rank, plan.ai_allowance_units, plan.capabilities,
             CASE WHEN subscription.plan_code=plan.code AND subscription.status='ACTIVE' THEN TRUE ELSE FALSE END AS current
      FROM worklog_subscription_plans plan
      LEFT JOIN worklog_user_subscriptions subscription ON subscription.user_id=${user.id}
      WHERE plan.enabled=TRUE
      ORDER BY plan.rank ASC, plan.price_twd ASC, plan.code ASC
    `);
    return c.json({ok:true,currentPlanCode:user.planCode,checkoutEnabled:false,plans:result.rows});
  });

  app.post('/checkout-intents',async c=>{
    const db=createDatabase(c.env.DATABASE_URL);const user=await userRow(db,c.get('lineUserId'));if(!user)return c.json({ok:false,error:'WORKLOG_USER_NOT_FOUND'},404);
    let body:unknown;try{body=await c.req.json();}catch{return c.json({ok:false,error:'INVALID_JSON'},400);}
    if(!body||typeof body!=='object'||Array.isArray(body))return c.json({ok:false,error:'INVALID_REQUEST'},400);
    const row=body as Record<string,unknown>;const planCode=typeof row.planCode==='string'?row.planCode.trim().toUpperCase():'';const requestKey=typeof row.requestKey==='string'?row.requestKey.trim():'';
    if(!/^[A-Z0-9_-]{1,64}$/.test(planCode))return c.json({ok:false,error:'INVALID_PLAN_CODE'},400);
    if(!/^[A-Za-z0-9_-]{16,64}$/.test(requestKey))return c.json({ok:false,error:'INVALID_REQUEST_KEY'},400);
    const planResult=await db.execute(sql`SELECT code,display_name,price_twd::text AS price_twd,enabled FROM worklog_subscription_plans WHERE code=${planCode} LIMIT 1`);
    const plan=planResult.rows[0] as {code?:string;display_name?:string;price_twd?:string;enabled?:boolean}|undefined;
    if(!plan?.code||!plan.enabled)return c.json({ok:false,error:'PLAN_NOT_AVAILABLE'},404);
    if(Number(plan.price_twd??0)<=0)return c.json({ok:false,error:'FREE_PLAN_DOES_NOT_REQUIRE_CHECKOUT'},409);

    const existing=await db.execute(sql`SELECT id::text AS id,user_id::text AS user_id,plan_code,status,checkout_url,created_at FROM worklog_checkout_intents WHERE request_key=${requestKey} LIMIT 1`);
    const found=existing.rows[0] as {id?:string;user_id?:string;plan_code?:string;status?:string;checkout_url?:string|null;created_at?:unknown}|undefined;
    if(found){
      if(Number(found.user_id)!==user.id||found.plan_code!==planCode)return c.json({ok:false,error:'CHECKOUT_IDEMPOTENCY_CONFLICT'},409);
      return c.json({ok:true,intent:{...found,checkoutEnabled:Boolean(found.checkout_url),providerConfigured:Boolean(found.checkout_url)}});
    }

    const inserted=await db.execute(sql`
      INSERT INTO worklog_checkout_intents(user_id,plan_code,request_key,status,created_at,updated_at)
      VALUES(${user.id},${planCode},${requestKey},'PENDING_PROVIDER',NOW(),NOW())
      RETURNING id::text AS id,plan_code,status,checkout_url,created_at
    `);
    return c.json({ok:true,intent:{...inserted.rows[0],checkoutEnabled:false,providerConfigured:false,message:'付款服務尚未啟用；此 checkout intent 已建立，接上支付 provider 後可沿用同一邊界。'}},201);
  });

  return app;
}

async function userRow(db:ReturnType<typeof createDatabase>,lineUserId:string){
  const result=await db.execute(sql`
    SELECT u.id::text AS id,COALESCE(s.plan_code,'FREE') AS plan_code
    FROM worklog_users u LEFT JOIN worklog_user_subscriptions s ON s.user_id=u.id
    WHERE u.line_user_id=${lineUserId} LIMIT 1
  `);const row=result.rows[0] as {id?:string;plan_code?:string}|undefined;if(!row?.id)return null;return{id:Number(row.id),planCode:row.plan_code??'FREE'};
}
