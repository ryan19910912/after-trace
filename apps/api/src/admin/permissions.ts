import pages from '../../../../config/admin-pages.json';
export const adminPermissionPages = pages;
export const allAdminPermissions = adminPermissionPages.flatMap((p) => p.permissions);
export function permissionForAdminPath(path: string, method: string): string | null {
  const write = !['GET','HEAD','OPTIONS'].includes(method);
  if(path==='/api/v1/admin/client-errors')return null;
  if (path === '/api/v1/admin/session' || path === '/api/v1/admin/password') return null;
  if (/^\/api\/v1\/admin\/users\/\d+\/records/.test(path)) return 'users.history';
  if (path.startsWith('/api/v1/admin/users')) return 'users.read';
  const prefixes: [string,string][] = [['error-logs','errors'],['local-ai-prompts','ai_prompts'],['local-ai-models','ai_models'],['feedback-management','feedback'],['notifications','announcements'],['roles','roles'],['permissions','permissions'],['staff','admin_accounts']];
  const prefix = prefixes.find(([value]) => path === '/api/v1/admin/' + value || path.startsWith('/api/v1/admin/' + value + '/'));
  return prefix ? prefix[1] + (write ? '.write' : '.read') : 'RETIRED_ADMIN_PAGE';
}
export function validPermissions(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string' && allAdminPermissions.includes(v)) && new Set(value).size === value.length && value.every((v) => !v.endsWith('.write') || value.includes(v.replace('.write','.read'))) && (!value.includes('users.history') || value.includes('users.read'));
}
