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
  if (parsed.events.length === 0) {
    return c.json({
      ok: true,
      lifecycleEvents: 0,
      storedMessages: 0,
      duplicateMessages: 0,
      ignoredInactiveMessages: 0,
      extractionCandidates: 0,
    });
  }

  const config = resolveProductConfig(c.env);
  const repository = new DrizzleConversationRepository(createDatabase(c.env.DATABASE_URL));
  const service = new ConversationIngestionService(repository, config);

  let lifecycleEvents = 0;
  let storedMessages = 0;
  let duplicateMessages = 0;
  let ignoredInactiveMessages = 0;
  let extractionCandidates = 0;

  for (const parsedEvent of parsed.events) {
    if (parsedEvent.kind === 'LIFECYCLE') {
      const event = parsedEvent.event;
      await service.handleLifecycle(event.lineGroupId, event.type, event.lineTimestamp);
      lifecycleEvents += 1;
      continue;
    }

    const message = parsedEvent.message;
    const result = await service.ingest(message);
    if (result.status === 'IGNORED_INACTIVE') {
      ignoredInactiveMessages += 1;
      continue;
    }

    if (result.status === 'DUPLICATE') duplicateMessages += 1;
    else storedMessages += 1;

    if (result.status === 'STORED' && result.threshold.extractionDue) {
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
    lifecycleEvents,
    storedMessages,
    duplicateMessages,
    ignoredInactiveMessages,
    extractionCandidates,
  });
});

export default app;
