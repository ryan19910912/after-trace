import seeds from "../../../config/local-ai-models.seed.json";
export type LocalModelConfiguration = {
  visionModel: string;
  visionRevision: string;
  speechModel: string;
  speechRevision: string;
  speechDtype?: "q4" | "q8";
  speechFallbackDtype?: "q4" | "q8";
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
    speech = seeds.find((m) => m.id === "onnx-community/whisper-small")!;
  return {
    visionModel: vision.id,
    visionRevision: vision.revision,
    speechModel: speech.id,
    speechRevision: speech.revision,
    speechDtype: "q8",
    speechFallbackModel: null,
    speechFallbackRevision: null,
    speechDownloadBytes: speech.downloadBytes,

    version: 3,
  };
}
