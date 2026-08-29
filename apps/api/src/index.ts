import { Hono } from 'hono';
import { resolveProductConfig, type ProductConfigEnv } from './config/product';
import { DrizzleConversationRepository } from './conversation/drizzle-repository';
import { ConversationIngestionService } from './conversation/service';
import { DrizzleCreditLedgerRepository } from './credits/drizzle-ledger';
import { DrizzleWelcomeCreditRepository } from './credits/drizzle-welcome';
import { CreditLedgerService } from './credits/ledger';
import { WelcomeCreditService } from './credits/welcome';
import { createDatabase } from './db/client';
import { DrizzleExtractionClaimRepository } from './extraction/drizzle-repository';
import { ConversationExtractionCoordinator } from './extraction/service';
import { detectExplicitMemoryCommand } from './line/commands';
import { parseLineWebhook } from './line/events';
import { verifyLineSignature } from './line/signature';
import { createManagementRoutes } from './management/routes';
import { DrizzleMemoryRequestRepository } from './memory/drizzle-request-repository';
import { ExplicitMemoryRequestService } from './memory/requests';
import { AutomaticMemoryRequestService } from './memory/work';

export type Bindings = ProductConfigEnv & {
  DATABASE_URL: string;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LIFF_CHANNEL_ID: string;
  GEMINI_API_KEY: string;
  LIFF_WEB_ORIGIN?: string;
  REMINDER_RESERVATION_COST_TWD?: string;
};

const app = new Hono<{ Bindings: Bindings }>();
app.route('/api/v1/management', createManagementRoutes());

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
      welcomeCreditGrants: 0,
      explicitMemoryRequests: 0,
      blockedMemoryRequests: 0,
      automaticMemoryRequests: 0,
      extractionCandidates: 0,
      extractionClaims: 0,
    });
  }

  const config = resolveProductConfig(c.env);
  const database = createDatabase(c.env.DATABASE_URL);
  const conversationRepository = new DrizzleConversationRepository(database);
  const conversationService = new ConversationIngestionService(conversationRepository, config);
  const extractionRepository = new DrizzleExtractionClaimRepository(database);
  const extractionCoordinator = new ConversationExtractionCoordinator(extractionRepository, config);
  const creditLedger = new CreditLedgerService(new DrizzleCreditLedgerRepository(database));
  const welcomeCreditService = new WelcomeCreditService(
    new DrizzleWelcomeCreditRepository(database),
    creditLedger,
    config,
  );
  const memoryRequestRepository = new DrizzleMemoryRequestRepository(database);
  const explicitMemoryRequestService = new ExplicitMemoryRequestService(memoryRequestRepository);
  const automaticMemoryRequestService = new AutomaticMemoryRequestService(memoryRequestRepository);

  let lifecycleEvents = 0;
  let storedMessages = 0;
  let duplicateMessages = 0;
  let ignoredInactiveMessages = 0;
  let welcomeCreditGrants = 0;
  let explicitMemoryRequests = 0;
  let blockedMemoryRequests = 0;
  let automaticMemoryRequests = 0;
  let extractionCandidates = 0;
  let extractionClaims = 0;

  for (const parsedEvent of parsed.events) {
    if (parsedEvent.kind === 'LIFECYCLE') {
      const event = parsedEvent.event;
      await conversationService.handleLifecycle(event.lineGroupId, event.type, event.lineTimestamp);
      lifecycleEvents += 1;
      continue;
    }

    const message = parsedEvent.message;
    const result = await conversationService.ingest(message);
    if (result.status === 'IGNORED_INACTIVE') {
      ignoredInactiveMessages += 1;
      continue;
    }

    if (result.status === 'DUPLICATE') duplicateMessages += 1;
    else storedMessages += 1;

    if (message.lineUserId) {
      const welcome = await welcomeCreditService.ensureForObservedMember(
        result.groupId,
        message.lineUserId,
        message.lineTimestamp,
      );
      if (welcome.status === 'GRANTED') {
        welcomeCreditGrants += 1;
      } else if (
        welcome.status === 'REFERENCE_CONFLICT' ||
        welcome.status === 'PERSISTENCE_CONFLICT'
      ) {
        throw new Error(`welcome credit consistency failure: ${welcome.status}`);
      }
    }

    const explicitMemoryCommand = detectExplicitMemoryCommand(message);
    if (explicitMemoryCommand) {
      const request = await explicitMemoryRequestService.enqueue(
        result.groupId,
        message,
        explicitMemoryCommand,
      );
      if (request.status === 'PENDING') explicitMemoryRequests += 1;
      else blockedMemoryRequests += 1;
    }

    if (result.threshold.extractionDue) {
      extractionCandidates += 1;
    }

    const claim = await extractionCoordinator.claimDueBatch(result.groupId);
    if (claim) {
      extractionClaims += 1;
      const automaticRequest = await automaticMemoryRequestService.ensureForExtractionBatch(
        result.groupId,
        claim.id,
        message.lineTimestamp,
      );
      if (automaticRequest.created) automaticMemoryRequests += 1;

      console.log(
        JSON.stringify({
          event: 'conversation_extraction_claimed',
          extractionBatchId: claim.id,
          memoryRequestId: automaticRequest.id,
          memoryRequestCreated: automaticRequest.created,
          messageCount: claim.messageCount,
          charCount: claim.charCount,
          attemptCount: claim.attemptCount,
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
    welcomeCreditGrants,
    explicitMemoryRequests,
    blockedMemoryRequests,
    automaticMemoryRequests,
    extractionCandidates,
    extractionClaims,
  });
});

export default app;
