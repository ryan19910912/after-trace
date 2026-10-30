import { describe, expect, it, vi } from 'vitest';
import { browserSpeechRecognitionSupported, createBrowserSpeechRecognition } from './speech-input';
describe('no browser speech service fallback', () => {
  it('never instantiates standard or webkit speech recognition which may use a server', () => {
    const Constructor = vi.fn();
    const host = { SpeechRecognition: Constructor, webkitSpeechRecognition: Constructor };
    expect(browserSpeechRecognitionSupported(host)).toBe(false);
    expect(createBrowserSpeechRecognition({ onTranscript: vi.fn() }, host)).toBeNull();
    expect(Constructor).not.toHaveBeenCalled();
  });
});
