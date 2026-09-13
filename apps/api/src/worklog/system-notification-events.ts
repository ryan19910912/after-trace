import { NotificationService } from './notifications';

export type SubscriptionSystemEvent =
  | { type: 'ACTIVATED'; subscriptionId: number; planCode: string; periodStart: Date; periodEnd?: Date | null }
  | { type: 'RENEWED'; subscriptionId: number; periodStart: Date; periodEnd?: Date | null }
  | { type: 'CANCELLED'; subscriptionId: number; periodEnd?: Date | null }
  | { type: 'AI_LIMIT_REACHED'; periodKey: string };

export async function notifyFreeTrialIssued(
  service: NotificationService,
  userId: number,
  grantId: number,
): Promise<void> {
  await service.createSystemNotification({
    eventKey: 'free-ai-trial-issued:v1',
    userId,
    title: '免費 AI 搜尋體驗已開啟',
    body: '你的帳號已取得一次性的 AI 搜尋體驗額度，可在搜尋頁使用自然語言找紀錄；一般紀錄與一般搜尋仍會持續免費使用。',
    deepLink: '/ai-search?tab=ai',
    referenceType: 'AI_GRANT',
    referenceId: grantId,
    metadata: { entitlementSource: 'FREE_TRIAL' },
    pushEnabled: true,
  });
}

export async function notifySubscriptionEvent(
  service: NotificationService,
  userId: number,
  event: SubscriptionSystemEvent,
): Promise<void> {
  switch (event.type) {
    case 'ACTIVATED':
      await service.createSystemNotification({
        eventKey: `subscription:${event.subscriptionId}:activated:${event.periodStart.toISOString()}`,
        userId,
        title: 'AI Pro 已啟用',
        body: '你的 AI Pro 訂閱已啟用。AI 功能受公平使用原則與每月方案資源上限限制。',
        deepLink: '/subscription',
        referenceType: 'SUBSCRIPTION',
        referenceId: event.subscriptionId,
        metadata: {
          planCode: event.planCode,
          periodStart: event.periodStart.toISOString(),
          periodEnd: iso(event.periodEnd),
        },
        pushEnabled: true,
      });
      return;
    case 'RENEWED':
      await service.createSystemNotification({
        eventKey: `subscription:${event.subscriptionId}:renewed:${event.periodStart.toISOString()}`,
        userId,
        title: 'AI Pro 已續訂',
        body: '新的 AI Pro 使用週期已開始。',
        deepLink: '/subscription',
        referenceType: 'SUBSCRIPTION',
        referenceId: event.subscriptionId,
        metadata: { periodStart: event.periodStart.toISOString(), periodEnd: iso(event.periodEnd) },
        pushEnabled: true,
      });
      return;
    case 'CANCELLED': {
      const periodKey = iso(event.periodEnd) ?? 'immediate';
      await service.createSystemNotification({
        eventKey: `subscription:${event.subscriptionId}:cancelled:${periodKey}`,
        userId,
        title: 'AI Pro 訂閱狀態已更新',
        body: event.periodEnd
          ? `你的 AI Pro 已取消續訂，目前方案可使用至 ${formatTaipei(event.periodEnd)}。`
          : '你的 AI Pro 訂閱已取消。',
        deepLink: '/subscription',
        referenceType: 'SUBSCRIPTION',
        referenceId: event.subscriptionId,
        metadata: { periodEnd: iso(event.periodEnd) },
        pushEnabled: true,
      });
      return;
    }
    case 'AI_LIMIT_REACHED':
      await service.createSystemNotification({
        eventKey: `ai-limit:${event.periodKey}`,
        userId,
        title: '本期 AI 使用量已達上限',
        body: '本期 AI 功能已暫停，將於下一個方案週期恢復；手動紀錄功能不受影響。',
        deepLink: '/subscription',
        referenceType: 'AI_USAGE_PERIOD',
        metadata: { periodKey: event.periodKey },
        pushEnabled: true,
      });
  }
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function formatTaipei(value: Date): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}
