import { Hono } from 'hono';
import { resolveProductConfig, type ProductConfigEnv } from './config/product';
import { DrizzleConversationRepository } from './conversation/drizzle-repository';
import { ConversationIngestionService } from './conversation/service';
import { createDatabase } from './db/client';
import { parseLineWebhook } from './line/events';
import { verifyLineSignature } from './line/signature';

export type Bindings = ProductConfigEnv & {
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

app.post('/webhooks/line', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('x-line-signature');
  if (!signature || !(await verifyLineSignature(rawBody, signature, c.env.LINE_CHANNEL_SECRET))) {
    return c.json({ ok: false, error: 'INVALID_LINE_SIGNATURE' }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
  }

  const parsed = parseLineWebhook(payload);
  const config = resolveProductConfig(c.env);
  const repository = new DrizzleConversationRepository(createDatabase(c.env.DATABASE_URL));
  const service = new ConversationIngestionService(repository, config);

  for (const event of parsed.lifecycleEvents) {
    await service.handleLifecycle(event.lineGroupId, event.type, event.lineTimestamp);
  }

  let storedMessages = 0;
  let duplicateMessages = 0;
  let extractionCandidates = 0;

  for (const message of parsed.messages) {
    const result = await service.ingest(message);
    if (result.duplicate) duplicateMessages += 1;
    else storedMessages += 1;

    if (!result.duplicate && result.threshold.extractionDue) {
      extractionCandidates += 1;
      console.log(
        JSON.stringify({
          event: 'conversation_extraction_due',
          reason: result.threshold.reason,
          pendingMessageCount: result.counters.messageCount,
          pendingCharCount: result.counters.charCount,
        }),
      );
    }
  }

  return c.json({
    ok: true,
    lifecycleEvents: parsed.lifecycleEvents.length,
    storedMessages,
    duplicateMessages,
    extractionCandidates,
  });
});

export default app;
