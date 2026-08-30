import { Hono } from 'hono';
import { createDatabase } from '../db/client';
import type { Bindings } from '../env';
import { parseAvailabilitySearchQuery } from './query';
import { DrizzleAvailabilityRepository } from './repository';

export function createAvailabilityRoutes() {
  const app = new Hono<{ Bindings: Bindings }>();

  app.use('*', async (c, next) => {
    if (!c.env.DATABASE_URL?.trim()) {
      return c.json({ ok: false, error: 'DATABASE_NOT_CONFIGURED' }, 503);
    }
    await next();
  });

  app.get('/sports', async (c) => {
    const repository = new DrizzleAvailabilityRepository(createDatabase(c.env.DATABASE_URL));
    return c.json({ ok: true, sports: await repository.listSports() });
  });

  app.get('/venues', async (c) => {
    const repository = new DrizzleAvailabilityRepository(createDatabase(c.env.DATABASE_URL));
    const sport = c.req.query('sport')?.trim() || undefined;
    return c.json({ ok: true, venues: await repository.listVenues(sport) });
  });

  app.get('/availability', async (c) => {
    const parsed = parseAvailabilitySearchQuery(c.req.query());
    if (!parsed.success) {
      return c.json({ ok: false, error: 'INVALID_QUERY', details: parsed.error.flatten() }, 400);
    }

    const repository = new DrizzleAvailabilityRepository(createDatabase(c.env.DATABASE_URL));
    return c.json({ ok: true, slots: await repository.search(parsed.data) });
  });

  return app;
}
