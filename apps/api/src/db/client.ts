import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema-all';

const defaultFetchEndpoint = neonConfig.fetchEndpoint;
// Only explicit loopback database URLs use the Docker Neon-compatible HTTP proxy.
// Real Neon hosts keep the driver's original HTTPS routing.
neonConfig.fetchEndpoint = (host, port, options) => {
  if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]') {
    if (!port || String(port) === '443') throw new Error('LOCAL_DATABASE_PROXY_PORT_REQUIRED');
    return `http://${host}:${port}/sql`;
  }
  return typeof defaultFetchEndpoint === 'function' ? defaultFetchEndpoint(host, port, options) : defaultFetchEndpoint;
};

export function createDatabase(databaseUrl: string, options?: {signal?:AbortSignal}) {
  const sql = neon(databaseUrl,options?.signal?{fetchOptions:{signal:options.signal}}:undefined);
  return drizzle(sql, { schema });
}

export type Database = ReturnType<typeof createDatabase>;
