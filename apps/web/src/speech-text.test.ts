import { describe, it, expect } from 'vitest';
import { normalizeSpeechText, validateSpeechSignal } from './speech-text';
describe('offline speech text and input', () => {
  it('converts simplified output while preserving facts, numbers and mixed English', () => {
    expect(normalizeSpeechText('王先生收到款项3,500元，尾款还没有收到，API测试。')).toBe('王先生收到款項3,500元，尾款還沒有收到，API測試。');
  });
  it('does not invent homophone corrections or rewrite names', () => {
    expect(normalizeSpeechText('微款 唯款 阿澤 復笨')).toBe('微款 唯款 阿澤 復笨');
  });
  it('preserves English and does not apply Taiwan vocabulary rewriting', () => {
    expect(normalizeSpeechText('  Software API 123 ', 'english')).toBe('Software API 123');
    expect(normalizeSpeechText('软件')).toBe('軟件');
  });
  it('rejects silence and corrupt audio but accepts quiet speech', () => {
    expect(() => validateSpeechSignal(new Float32Array(16000))).toThrow('沒有收到聲音');
    expect(() => validateSpeechSignal(new Float32Array([NaN]))).toThrow('錄音資料無效');
    expect(() => validateSpeechSignal(new Float32Array([Infinity]))).toThrow('錄音資料無效');
    expect(() => validateSpeechSignal(new Float32Array([0.0001, -0.0002]))).not.toThrow();
  });
});
