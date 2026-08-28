import { Hono } from 'hono';

export type Bindings = {
  DATABASE_URL: string;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  GEMINI_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/health', (c) =>
  c.json({
    service: 'after-trace-api',
    status: 'ok',
  }),
);

export default app;
