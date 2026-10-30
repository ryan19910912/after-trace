import {reportAdminConnection} from './diagnostics';
// Shared expiry handling, including pages that previously only removed a token silently.
export async function adminFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let response:Response;
  const timeout=AbortSignal.timeout(15000);
  try { response=await fetch(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,timeout]):timeout}); }
  catch(error){if(!init?.signal?.aborted)reportAdminConnection();if(timeout.aborted)throw new Error('連線逾時。若剛才執行儲存或建立，請先重新整理確認結果，再決定是否重試。');if(init?.signal?.aborted)throw error;throw new Error('無法連線至後台服務，請檢查網路後重試；尚未儲存的內容仍保留。');}
  if(response.status>=500&&typeof window!=='undefined'){const id=response.headers.get('X-Request-ID');if(id)window.dispatchEvent(new CustomEvent('aftertrace:admin-diagnostic',{detail:{id,kind:'requestId'}}));}
  if (response.status === 401 && !String(input).endsWith('/login') && typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem('aftertrace.admin.session');
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('aftertrace:admin-expired'));
  }
  if (response.status === 403 && typeof window !== 'undefined') { const body = await response.clone().json().catch(() => ({})); if (body.error === 'ADMIN_PERMISSION_DENIED' || body.error === 'PASSWORD_CHANGE_REQUIRED') window.dispatchEvent(new Event('aftertrace:admin-permissions-changed')); }
  return response;
}
