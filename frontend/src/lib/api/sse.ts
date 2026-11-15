/**
 * Reads a streamed agent reply (backend/app/api/streaming.py): `delta` events carry the reply's text in
 * pieces, then one `done` event carries the endpoint's normal JSON body (cards, confirmations).
 * `onText` gets the text so far, at most every ~40 ms so each piece doesn't cause a re-render.
 */
export async function readStream<T>(res: Response, onText: (soFar: string) => void): Promise<T> {
  if (!res.body) throw new Error("The reply was empty.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let shownAt = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const name = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (data === undefined) continue;
      if (name === "done") {
        onText(text);
        return JSON.parse(data) as T;
      }
      if (name === "delta") {
        text += (JSON.parse(data) as { text: string }).text;
        if (Date.now() - shownAt > 40) {
          shownAt = Date.now();
          onText(text);
        }
      }
    }
  }
  throw new Error("The reply was cut off. Try again.");
}

/** True when the response is a stream; errors come back as ordinary JSON instead. */
export const isStream = (res: Response) => res.ok && (res.headers.get("content-type") ?? "").includes("text/event-stream");
