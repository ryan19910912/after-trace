import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiCaptureApi } from './ai-capture-api';
afterEach(() => vi.unstubAllGlobals());
describe('retired cloud capture client', () => {
  it('never sends text, images, audio or files to the old backend AI endpoints', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const api = new AiCaptureApi('https://api.example.test');
    const file = {} as File;
    for (const operation of [() => api.entitlement('session', 1), () => api.captureText('session', 1, 'private'), () => api.captureImage('session', 1, file), () => api.captureAudio('session', 1, file), () => api.captureFile('session', 1, file)]) {
      await expect(operation()).rejects.toThrow('LOCAL_AI_ONLY');
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
