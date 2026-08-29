import type { ProactiveService, ProactiveEnqueueResult } from './service';

export type ApprovedProactiveTrigger = {
  ownerLineUserId: string;
  groupId: number;
  sourceType: string;
  sourceId: string;
  message: string;
  scheduledFor: Date;
};

/**
 * Product/domain modules may propose proactive work, but they must not write the
 * proactive queue directly. A producer is responsible only for deciding whether a
 * product event merits a message and returning an approved trigger. Membership,
 * User capability, idempotency and delivery safety remain centralized downstream.
 */
export interface ProactiveTriggerProducer<TEvent> {
  produce(event: TEvent, at: Date): Promise<ApprovedProactiveTrigger | null>;
}

export class ProactiveTriggerDispatcher {
  constructor(private readonly proactive: Pick<ProactiveService, 'enqueue'>) {}

  async dispatch<TEvent>(
    producer: ProactiveTriggerProducer<TEvent>,
    event: TEvent,
    at = new Date(),
  ): Promise<ProactiveEnqueueResult | { status: 'NO_TRIGGER' }> {
    const trigger = await producer.produce(event, at);
    if (!trigger) return { status: 'NO_TRIGGER' };
    return this.proactive.enqueue({
      ownerLineUserId: trigger.ownerLineUserId,
      groupId: trigger.groupId,
      sourceType: trigger.sourceType,
      sourceId: trigger.sourceId,
      message: trigger.message,
      scheduledFor: trigger.scheduledFor,
      at,
    });
  }
}
