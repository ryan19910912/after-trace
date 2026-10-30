/** Local metadata only; diagnostics never leave this device. */
export function reportLocalError(code: string, modelChoice = "VISION") {
  try {
    const current = JSON.parse(
      localStorage.getItem("aftertrace.local-diagnostics") ?? "[]",
    );
    const list = Array.isArray(current) ? current : [];
    const event = {
      eventId: crypto.randomUUID(),
      code,
      modelChoice,
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem(
      "aftertrace.local-diagnostics",
      JSON.stringify([...list.slice(-49), event]),
    );
    window.dispatchEvent(
      new CustomEvent("aftertrace:diagnostic", {
        detail: { id: event.eventId, kind: "eventId" },
      }),
    );
  } catch {
    /* No impact on user operation. */
  }
}
