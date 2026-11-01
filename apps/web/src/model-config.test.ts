import { describe, it, expect } from "vitest";
import { getModelConfiguration } from "./model-config";
describe("lightweight speech trial configuration", () => {
  it("pins multilingual small Q8 under 260 MB without large fallback", async () => {
    const c = await getModelConfiguration();
    expect(c.speechModel).toBe("onnx-community/whisper-small");
    expect(c.speechRevision).toBe("36050c46d777d46dc4b5f43f6d90574fc38f8732");
    expect(c.speechDtype).toBe("q8");
    expect(c.speechDownloadBytes).toBeLessThan(260_000_000);
    expect(c.speechFallbackModel).toBeNull();
  });
});
