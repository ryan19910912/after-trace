import type { NotificationDispatchSummary } from '../notifications/dispatcher';
import type { PollingRunResult } from '../polling/orchestrator';
import type { RadarMatchResult } from '../watch/matcher';

export type ScheduledStage = 'polling' | 'radar' | 'push';

export type ScheduledStageFailure = {
  stage: ScheduledStage;
  errorCode: string;
};

export type ScheduledPollingSummary = PollingRunResult & {
  metadataRefreshed?: boolean;
  metadataSourcesDue?: number;
  metadataSourcesRefreshed?: number;
  metadataSourcesFailed?: number;
  metadataFailedSourceCodes?: string[];
  invalidTargetsDisabled?: number;
  demandTargetsUpdated?: number;
  watchedTargets?: number;
};

export type ScheduledPushSummary = NotificationDispatchSummary & {
  invalidated?: number;
};

export type ScheduledRadarRunSummary = {
  polling: ScheduledPollingSummary | null;
  radar: RadarMatchResult | null;
  push: ScheduledPushSummary | null;
  failures: ScheduledStageFailure[];
};

type ScheduledPollingStage = {
  run(): Promise<ScheduledPollingSummary>;
};

type ScheduledRadarStage = {
  matchPendingAvailableEvents(): Promise<RadarMatchResult>;
};

type ScheduledPushStage = {
  run(): Promise<ScheduledPushSummary>;
};

/**
 * Runs the three cron responsibilities independently.
 *
 * A provider/metadata/polling failure must not prevent Radar from matching
 * already persisted availability events, and neither of those stages may
 * prevent previously-created Push deliveries from being dispatched. Every
 * stage is retried naturally by the next cron wake-up.
 */
export class ScheduledRadarRunner {
  constructor(
    private readonly polling: ScheduledPollingStage,
    private readonly radar: ScheduledRadarStage,
    private readonly push: ScheduledPushStage,
  ) {}

  async run(): Promise<ScheduledRadarRunSummary> {
    const summary: ScheduledRadarRunSummary = {
      polling: null,
      radar: null,
      push: null,
      failures: [],
    };

    try {
      summary.polling = await this.polling.run();
    } catch (error) {
      summary.failures.push({ stage: 'polling', errorCode: scheduledErrorCode(error) });
    }

    try {
      summary.radar = await this.radar.matchPendingAvailableEvents();
    } catch (error) {
      summary.failures.push({ stage: 'radar', errorCode: scheduledErrorCode(error) });
    }

    try {
      summary.push = await this.push.run();
    } catch (error) {
      summary.failures.push({ stage: 'push', errorCode: scheduledErrorCode(error) });
    }

    return summary;
  }
}

function scheduledErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'UNKNOWN_SCHEDULED_FAILURE';
  const explicitCode = (error as Error & { code?: unknown }).code;
  if (typeof explicitCode === 'string' && /^[A-Z0-9_]{2,128}$/.test(explicitCode)) {
    return explicitCode;
  }
  if (/^[A-Z0-9_]{2,128}$/.test(error.message)) return error.message;
  return 'SCHEDULED_STAGE_FAILED';
}
