import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createAvailabilityRoutes } from './availability/routes';
import type { Bindings } from './env';

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors());
app.get('/health', (c) => c.json({ service: 'after-trace-api', product: 'sports-availability-radar', status: 'ok' }));
app.route('/api/v1', createAvailabilityRoutes());

export type { Bindings } from './env';
export default app;
