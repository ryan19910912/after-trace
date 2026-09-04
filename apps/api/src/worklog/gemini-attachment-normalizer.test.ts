import { describe, expect, it } from 'vitest';
import type { LineMessageContent } from '../line/content';
import { GeminiWorklogAttachmentNormalizer } from './gemini-attachment-normalizer';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

const config: WorklogAiRuntimeConfigSnapshot = {
  provider: 'GOOGLE',
  model: 'gemini-3.5-flash',
  inputUsdPerMillion: 0.25,
  outputUsdPerMillion: 1.5,
  audioUsdPerMillion: 0.5,
  imageUsdPerMillion: 0.25,
  usdTwdRate: 32,
};

const image: LineMessageContent = {
  lineMessageId: 'image-1',
  mimeType: 'image/jpeg',
  byteLength: 3,
  dataBase64: 'YWJj',
};

function providerBody(usageMetadata: Record<string, unknown>) {
  return {
    responseId: 'response-1',
    candidates: [{
      content: {
        parts: [{ text: JSON.stringify({ raw_text: '配電箱' }) }],
      },
    }],
    usageMetadata,
  };
}

function fetchJson(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
}

describe('GeminiWorklogAttachmentNormalizer modality usage', () => {
  it('keeps total prompt tokens for quota while exposing IMAGE as a subset for pricing', async () => {
    const normalizer = new GeminiWorklogAttachmentNormalizer({
      apiKey: 'test-key',
      fetchFn: fetchJson(providerBody({
        promptTokenCount: 1200,
        candidatesTokenCount: 100,
        promptTokensDetails: [
          { modality: 'TEXT', tokenCount: 200 },
          { modality: 'IMAGE', tokenCount: 1000 },
        ],
      })),
    });

    await expect(normalizer.analyze(image, config)).resolves.toMatchObject({
      output: { rawText: '配電箱' },
      inputTokens: 1200,
      outputTokens: 100,
      audioInputUnits: 0,
      imageInputUnits: 1000,
    });
  });

  it('does not invent a media split when Gemini omits promptTokensDetails', async () => {
    const normalizer = new GeminiWorklogAttachmentNormalizer({
      apiKey: 'test-key',
      fetchFn: fetchJson(providerBody({
        promptTokenCount: 1200,
        candidatesTokenCount: 100,
      })),
    });

    await expect(normalizer.analyze(image, config)).resolves.toMatchObject({
      inputTokens: 1200,
      audioInputUnits: 0,
      imageInputUnits: 0,
    });
  });

  it('rejects impossible modality details that exceed the total prompt token count', async () => {
    const normalizer = new GeminiWorklogAttachmentNormalizer({
      apiKey: 'test-key',
      fetchFn: fetchJson(providerBody({
        promptTokenCount: 100,
        candidatesTokenCount: 10,
        promptTokensDetails: [
          { modality: 'TEXT', tokenCount: 40 },
          { modality: 'IMAGE', tokenCount: 80 },
        ],
      })),
    });

    await expect(normalizer.analyze(image, config)).rejects.toMatchObject({
      code: 'GEMINI_INVALID_RESPONSE',
    });
  });
});
