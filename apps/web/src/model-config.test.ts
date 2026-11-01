import { describe, it, expect } from "vitest";
import { getModelConfiguration } from "./model-config";
describe("lightweight speech trial configuration", () => {
  it("pins multilingual base Q8 under 90 MB without large fallback", async () => {
    const c = await getModelConfiguration();
    expect(c.speechModel).toBe("onnx-community/whisper-base");
    expect(c.speechRevision).toBe("1846881b6b3a3024392c1eea3ad983695bc23925");
    expect(c.speechDtype).toBe("q8");
    expect(c.speechDownloadBytes).toBeLessThan(90_000_000);
    expect(c.speechFallbackModel).toBeNull();
  });
});
