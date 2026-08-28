import type { ProductConfig } from '../config/product';

export type PendingCounters = {
  messageCount: number;
  charCount: number;
};

export type ExtractionThresholdDecision = {
  extractionDue: boolean;
  reason: 'MESSAGE_COUNT' | 'CHAR_COUNT' | 'BOTH' | null;
  largeMessage: boolean;
};

export function evaluateExtractionThreshold(
  counters: PendingCounters,
  currentMessageChars: number,
  config: ProductConfig,
): ExtractionThresholdDecision {
  const messageDue = counters.messageCount >= config.conversation.extractionMessageThreshold;
  const charDue = counters.charCount >= config.conversation.extractionCharThreshold;

  let reason: ExtractionThresholdDecision['reason'] = null;
  if (messageDue && charDue) reason = 'BOTH';
  else if (messageDue) reason = 'MESSAGE_COUNT';
  else if (charDue) reason = 'CHAR_COUNT';

  return {
    extractionDue: messageDue || charDue,
    reason,
    largeMessage: currentMessageChars >= config.conversation.largeMessageChars,
  };
}
