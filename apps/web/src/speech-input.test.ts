import { describe, expect, it } from 'vitest';
import {
  browserSpeechRecognitionSupported,
  collectSpeechTranscript,
  createBrowserSpeechRecognition,
  resolveSpeechRecognitionConstructor,
  speechRecognitionErrorMessage,
  type BrowserSpeechRecognition,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionHost,
} from './speech-input';

class FakeRecognition implements BrowserSpeechRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: BrowserSpeechRecognition['onresult'] = null;
  onerror: BrowserSpeechRecognition['onerror'] = null;
  onend: BrowserSpeechRecognition['onend'] = null;
  starts = 0;
  stops = 0;
  aborts = 0;

  start() {
    this.starts += 1;
  }

  stop() {
    this.stops += 1;
  }

  abort() {
    this.aborts += 1;
  }
}

function result(text: string, isFinal: boolean) {
  return Object.assign([{ transcript: text }], { isFinal });
}

describe('browser speech input', () => {
  it('detects standard and webkit-prefixed browser speech recognition constructors', () => {
    const standard: SpeechRecognitionHost = { SpeechRecognition: FakeRecognition };
    const prefixed: SpeechRecognitionHost = { webkitSpeechRecognition: FakeRecognition };

    expect(browserSpeechRecognitionSupported(standard)).toBe(true);
    expect(browserSpeechRecognitionSupported(prefixed)).toBe(true);
    expect(browserSpeechRecognitionSupported({})).toBe(false);
    expect(resolveSpeechRecognitionConstructor(standard)).toBe(FakeRecognition);
  });

  it('configures Traditional Chinese short-form capture and emits final/interim text separately', () => {
    const chunks: Array<{ finalText: string; interimText: string }> = [];
    const recognition = createBrowserSpeechRecognition(
      { onTranscript: (chunk) => chunks.push(chunk) },
      { SpeechRecognition: FakeRecognition },
    ) as FakeRecognition;

    expect(recognition.lang).toBe('zh-TW');
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    expect(recognition.maxAlternatives).toBe(1);

    recognition.onresult?.({
      resultIndex: 0,
      results: [result('今天完成 API', true), result('準備測試', false)],
    } as unknown as SpeechRecognitionEventLike);

    expect(chunks).toEqual([{ finalText: '今天完成 API', interimText: '準備測試' }]);
  });

  it('collects results only from the event result index onward', () => {
    const chunk = collectSpeechTranscript({
      resultIndex: 1,
      results: [result('舊結果', true), result('新的完成內容', true), result('新的暫存內容', false)],
    } as unknown as SpeechRecognitionEventLike);

    expect(chunk).toEqual({ finalText: '新的完成內容', interimText: '新的暫存內容' });
  });

  it('maps common browser speech failures to a manual-text fallback message', () => {
    expect(speechRecognitionErrorMessage('not-allowed')).toContain('麥克風權限');
    expect(speechRecognitionErrorMessage('audio-capture')).toContain('麥克風');
    expect(speechRecognitionErrorMessage('network')).toContain('無法連線');
    expect(speechRecognitionErrorMessage('no-speech')).toContain('沒有偵測到語音');
    expect(speechRecognitionErrorMessage('unknown')).toContain('文字輸入');
  });
});
