export type SpeechTranscriptChunk = {
  finalText: string;
  interimText: string;
};

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}

export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
}

export interface SpeechRecognitionErrorEventLike {
  readonly error?: string;
  readonly message?: string;
}

export interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
}

export type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

export type SpeechRecognitionHost = {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export type BrowserSpeechCallbacks = {
  onTranscript: (chunk: SpeechTranscriptChunk) => void;
  onError?: (code: string) => void;
  onEnd?: () => void;
};

export function resolveSpeechRecognitionConstructor(
  host: SpeechRecognitionHost = globalThis as unknown as SpeechRecognitionHost,
): SpeechRecognitionConstructor | null {
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

export function browserSpeechRecognitionSupported(
  host: SpeechRecognitionHost = globalThis as unknown as SpeechRecognitionHost,
): boolean {
  return resolveSpeechRecognitionConstructor(host) !== null;
}

export function createBrowserSpeechRecognition(
  callbacks: BrowserSpeechCallbacks,
  host: SpeechRecognitionHost = globalThis as unknown as SpeechRecognitionHost,
): BrowserSpeechRecognition | null {
  const Constructor = resolveSpeechRecognitionConstructor(host);
  if (!Constructor) return null;

  const recognition = new Constructor();
  recognition.lang = 'zh-TW';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => callbacks.onTranscript(collectSpeechTranscript(event));
  recognition.onerror = (event) => callbacks.onError?.(event.error ?? event.message ?? 'unknown');
  recognition.onend = () => callbacks.onEnd?.();
  return recognition;
}

export function collectSpeechTranscript(event: SpeechRecognitionEventLike): SpeechTranscriptChunk {
  const finalParts: string[] = [];
  const interimParts: string[] = [];

  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (!result) continue;
    const transcript = result[0]?.transcript?.trim();
    if (!transcript) continue;
    (result.isFinal ? finalParts : interimParts).push(transcript);
  }

  return {
    finalText: finalParts.join(' ').trim(),
    interimText: interimParts.join(' ').trim(),
  };
}

export function speechRecognitionErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '麥克風權限未開啟，請允許麥克風後再試，或直接使用文字輸入。';
    case 'audio-capture':
      return '找不到可用的麥克風，請檢查裝置後再試，或直接使用文字輸入。';
    case 'network':
      return '瀏覽器語音轉文字暫時無法連線，請稍後再試，或直接使用文字輸入。';
    case 'no-speech':
      return '沒有偵測到語音，可以再試一次或直接使用文字輸入。';
    default:
      return '語音轉文字沒有完成，可以再試一次或直接使用文字輸入。';
  }
}
