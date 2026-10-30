import seeds from "../../../config/local-ai-models.seed.json";
export type LocalModelConfiguration = {
  visionModel: string;
  visionRevision: string;
  speechModel: string;
  speechRevision: string;
  speechFallbackModel?: string | null;
  speechFallbackRevision?: string | null;
  speechDownloadBytes?: number;
  speechFallbackDownloadBytes?: number;
  version: number;
};
export async function getModelConfiguration(
  _baseUrl?: string,
): Promise<LocalModelConfiguration> {
  const vision = seeds.find((m) => m.kind === "vision")!,
    speech = seeds.find(
      (m) => m.id === "onnx-community/whisper-large-v3-ONNX",
    )!,
    fallback = seeds.find(
      (m) => m.id === "onnx-community/whisper-large-v3-turbo",
    )!;
  return {
    visionModel: vision.id,
    visionRevision: vision.revision,
    speechModel: speech.id,
    speechRevision: speech.revision,
    speechFallbackModel: fallback.id,
    speechFallbackRevision: fallback.revision,
    speechDownloadBytes: speech.downloadBytes,
    speechFallbackDownloadBytes: fallback.downloadBytes,
    version: 1,
  };
}
