import { describe, expect, it } from 'vitest';
import { defaultProductConfig } from '../config/product';
import { evaluateExtractionThreshold } from './threshold';

describe('evaluateExtractionThreshold', () => {
  it('triggers at the message threshold', () => {
    expect(
      evaluateExtractionThreshold(
        { messageCount: 80, charCount: 120 },
        5,
        defaultProductConfig,
      ),
    ).toMatchObject({ extractionDue: true, reason: 'MESSAGE_COUNT', largeMessage: false });
  });

  it('triggers at the character threshold and marks a large current message', () => {
    expect(
      evaluateExtractionThreshold(
        { messageCount: 2, charCount: 12_000 },
        2_000,
        defaultProductConfig,
      ),
    ).toMatchObject({ extractionDue: true, reason: 'CHAR_COUNT', largeMessage: true });
  });

  it('does not trigger before either extraction threshold', () => {
    expect(
      evaluateExtractionThreshold(
        { messageCount: 79, charCount: 11_999 },
        100,
        defaultProductConfig,
      ).extractionDue,
    ).toBe(false);
  });
});
