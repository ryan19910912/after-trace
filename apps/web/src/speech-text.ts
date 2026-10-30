import { Converter } from 'opencc-js/cn2t';
// Character conversion only: no answer dictionary or Taiwan phrase rewriting.
const traditional = Converter({ from: 'cn', to: 'tw' });
export function normalizeSpeechText(text: string, language: 'chinese' | 'english' = 'chinese'): string {
  return (language === 'chinese' ? traditional(text) : text).trim();
}
export function validateSpeechSignal(audio: Float32Array): void {
  let peak = 0;
  for (const sample of audio) {
    if (!Number.isFinite(sample)) throw new Error('錄音資料無效，請重新錄音。');
    peak = Math.max(peak, Math.abs(sample));
  }
  // Reject digital silence, without dropping quiet speech via an aggressive VAD.
  if (peak < 0.00001) throw new Error('沒有收到聲音，請確認麥克風後重新錄音。');
}
