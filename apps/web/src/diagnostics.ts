/** Only allowlisted diagnostic metadata is sent. Never pass an Error or user content. */
let sessionSeen='',recent=new Map<string,number>();
export function reportLocalError(code:'AI_MODEL_FAILED'|'AI_MEMORY_LIMIT'|'AI_OUTPUT_INVALID',modelChoice:'VISION'|'PRIMARY'|'FALLBACK'='VISION'){
 try{const token=localStorage.getItem('aftertrace.worklog.session');if(!token)return;if(token!==sessionSeen){recent=new Map();sessionSeen=token;}const key=code+modelChoice,now=Date.now();if(now-(recent.get(key)??0)<60000)return;recent.set(key,now);if(recent.size>30)recent.clear();const eventId=crypto.randomUUID(),base=import.meta.env.VITE_API_BASE_URL?.trim()??'';
 void fetch(base+'/api/v1/diagnostics/errors',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(3000),body:JSON.stringify({eventId,code,feature:location.pathname.includes('search')?'SEARCH':location.pathname.includes('task')?'TASKS':location.pathname.includes('ai-tools')?'SUMMARY':'CAPTURE',modelChoice})}).then(r=>{if(r.ok)window.dispatchEvent(new CustomEvent('aftertrace:diagnostic',{detail:{id:eventId,kind:'eventId'}}));}).catch(()=>{});
 }catch{/* Diagnostic failure never replaces the original operation/error. */}
}

export function noticeApiFailure(response:Response){const id=response.headers.get('X-Request-ID');if(response.status>=500&&id&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('aftertrace:diagnostic',{detail:{id,kind:'requestId'}}));}
