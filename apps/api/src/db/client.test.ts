import { afterEach, describe, expect, it, vi } from 'vitest';
import { neonConfig } from '@neondatabase/serverless';
import { createDatabase } from './client';
afterEach(()=>vi.unstubAllGlobals());
describe('Docker local Neon routing',()=>{
 it('uses HTTP only for explicit loopback proxy endpoints',()=>{
  const endpoint=neonConfig.fetchEndpoint;
  expect(typeof endpoint).toBe('function');
  if(typeof endpoint!=='function')throw new Error('Expected fetch endpoint router');
  expect(endpoint('127.0.0.1',55433)).toBe('http://127.0.0.1:55433/sql');
  expect(endpoint('localhost',55433)).toBe('http://localhost:55433/sql');
  expect(()=>endpoint('127.0.0.1',443)).toThrow('LOCAL_DATABASE_PROXY_PORT_REQUIRED');
  expect(endpoint('ep-example.neon.tech',443)).toMatch(/^https:\/\//);
 });
 it('retains the real Neon driver for SQL execution',async()=>{
  const fetch=vi.fn(async(_url: string)=>Response.json({fields:[{name:'value',dataTypeID:23}],rows:[['1']],rowCount:1,command:'SELECT',rowAsArray:true}));
  vi.stubGlobal('fetch',fetch);
  const database=createDatabase('postgresql://test:test@127.0.0.1:55433/aftertrace');
  const {sql}=await import('drizzle-orm');
  const result=await database.execute(sql`SELECT 1 AS value`);
  expect(result.rows[0]).toMatchObject({value:1});
  expect(String(fetch.mock.calls[0]?.[0])).toBe('http://127.0.0.1:55433/sql');
 });
});
