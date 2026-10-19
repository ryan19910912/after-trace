import { createDatabase } from '../db/client';
import { DrizzlePushDeliveryRepository } from './drizzle-push-delivery';
import { PushDeliveryService, type PushDeliveryBatchResult } from './push-delivery';
import { WorkerWebPushTransport, type WebPushVapidConfig } from './web-push-transport';

export type WebPushRuntimeBindings = {
  DATABASE_URL: string;
  WEB_PUSH_PUBLIC_KEY?: string;
  WEB_PUSH_PRIVATE_KEY?: string;
  WEB_PUSH_SUBJECT?: string;
};

export function webPushVapidConfig(env: WebPushRuntimeBindings): WebPushVapidConfig | null {
  const publicKey = env.WEB_PUSH_PUBLIC_KEY?.trim() ?? '';
  const privateKey = env.WEB_PUSH_PRIVATE_KEY?.trim() ?? '';
  const subject = env.WEB_PUSH_SUBJECT?.trim() ?? '';
  if (!publicKey && !privateKey && !subject) return null;
  if (!publicKey || !privateKey || !subject) throw new Error('WEB_PUSH_CONFIG_INCOMPLETE');
  return { publicKey, privateKey, subject };
}

export function webPushRuntimeConfigured(env: WebPushRuntimeBindings): boolean {
  try {
    const config = webPushVapidConfig(env);
    if (!config) return false;
    // Constructor validates VAPID public/private key shape and subject without performing I/O.
    void new WorkerWebPushTransport(config, async () => new Response(null, { status: 204 }));
    return true;
  } catch {
    return false;
  }
}

export async function deliverPendingPushBatch(
  env: WebPushRuntimeBindings,
  limit = 50,
): Promise<PushDeliveryBatchResult | null> {
  const config = webPushVapidConfig(env);
  if (!config) return null;
  const database = createDatabase(env.DATABASE_URL);
  const service = new PushDeliveryService(
    new DrizzlePushDeliveryRepository(database),
    new WorkerWebPushTransport(config),
  );
  return service.deliverPendingBatch(limit);
}
