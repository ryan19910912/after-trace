import { describe, expect, it, vi } from 'vitest';
import {
  ExtractionBatchInputService,
  type ExtractionInputRepository,
} from './input';

describe('ExtractionBatchInputService', () => {
  it('delegates loading of the claimed batch and previous successful context', async () => {
    const loadBatchInput = vi.fn(async () => ({
      batchId: 8,
      groupId: 3,
      currentMessages: [],
      previousContext: { batchId: 7, messages: [] },
    }));
    const repository: ExtractionInputRepository = { loadBatchInput };
    const service = new ExtractionBatchInputService(repository);

    await expect(service.load(8)).resolves.toMatchObject({
      batchId: 8,
      groupId: 3,
      previousContext: { batchId: 7 },
    });
    expect(loadBatchInput).toHaveBeenCalledWith(8);
  });

  it('rejects invalid batch ids before repository access', () => {
    const loadBatchInput = vi.fn();
    const service = new ExtractionBatchInputService({ loadBatchInput } as unknown as ExtractionInputRepository);

    expect(() => service.load(0)).toThrow('batchId must be a positive safe integer');
    expect(loadBatchInput).not.toHaveBeenCalled();
  });
});
