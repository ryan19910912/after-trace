/** Retired cloud capture client. All inference lives in local-ai.ts. */
export class AiCaptureApi {
  constructor(_baseUrl: string) {}
  async entitlement(_session: string, _sourceId: number): Promise<never> { throw new Error('LOCAL_AI_ONLY'); }
  async captureText(_session: string, _sourceId: number, _text: string): Promise<never> { throw new Error('LOCAL_AI_ONLY'); }
  async captureImage(_session: string, _sourceId: number, _file: File): Promise<never> { throw new Error('LOCAL_AI_ONLY'); }
  async captureAudio(_session: string, _sourceId: number, _file: File): Promise<never> { throw new Error('LOCAL_AI_ONLY'); }
  async captureFile(_session: string, _sourceId: number, _file: File): Promise<never> { throw new Error('LOCAL_AI_ONLY'); }
}
