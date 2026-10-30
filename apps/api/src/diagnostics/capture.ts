import type{Bindings}from'../index';import{bearerToken}from'../admin/auth';import{verifyWebSessionToken}from'../auth/token';import{writeError,errorAdmin}from'./store';import{routeKey}from'./policy';
export type DiagnosticContext={waitUntil(promise:Promise<unknown>):void};
export async function withRequestDiagnostics(request:Request,env:Bindings,context:DiagnosticContext,dispatch:(r:Request,e:Bindings,c:DiagnosticContext)=>Promise<Response>):Promise<Response>{
 const requestId=crypto.randomUUID(),headers=new Headers(request.headers);headers.set('x-aftertrace-request-id',requestId);const traced=new Request(request,{headers});let response:Response;
 try{response=await dispatch(traced,env,context);}catch{response=Response.json({error:'INTERNAL_SERVER_ERROR'},{status:500});}
 const path=new URL(request.url).pathname;
 if(response.status>=500&&!path.includes('/error-logs')&&!path.includes('/client-errors')&&!path.includes('/diagnostics/')){
  const job=(async()=>{let userId:number|undefined;const token=bearerToken(request.headers.get('authorization')??undefined);if(token&&env.WEB_AUTH_SECRET){userId=(await verifyWebSessionToken(token,env.WEB_AUTH_SECRET).catch(()=>null))?.userId;}
   console.error(JSON.stringify({event:'API_ERROR',requestId,route:routeKey(path),status:response.status}));await writeError(env.DATABASE_URL,{eventId:requestId,requestId,source:'API',feature:path.startsWith('/api/v1/admin/')?'ADMIN':path.includes('/tasks')?'TASKS':path.includes('/worklog/records')?'CAPTURE':'API',code:'API_UNAVAILABLE',routeKey:routeKey(path),httpStatus:response.status,userId,adminId:errorAdmin(traced)});})();if(context?.waitUntil)context.waitUntil(job.catch(()=>console.error(JSON.stringify({event:'ERROR_LOG_WRITE_FAILED',requestId}))));else void job.catch(()=>{});
 }
 const h=new Headers(response.headers);h.set('X-Request-ID',requestId);h.set('Access-Control-Expose-Headers',[h.get('Access-Control-Expose-Headers'),'X-Request-ID'].filter(Boolean).join(', '));const origin=request.headers.get('origin');if(response.status>=500&&origin&&(origin===env.ADMIN_WEB_ORIGIN||origin===env.WEB_APP_ORIGIN)){h.set('Access-Control-Allow-Origin',origin);h.set('Vary','Origin');}
 if(response.status>=400&&h.get('content-type')?.includes('application/json')){try{const parsed=await response.clone().json();const body=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as Record<string,unknown>:{};h.delete('content-length');return Response.json({...body,requestId},{status:response.status,headers:h});}catch{}}
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});

}
