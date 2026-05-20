const { parentPort } = require("worker_threads");
const { extractDynamicFromBuffer } = require("./parserExtractor.cjs");

if (parentPort) {
  parentPort.on("message", (msg) => {
    const id = msg && msg.id;
    try {
      const buffer = msg && msg.buffer;
      const parserFields = msg && msg.parserFields;
      const result = extractDynamicFromBuffer(buffer, parserFields);
      parentPort.postMessage({ id, ok: true, result });
    } catch (e) {
      parentPort.postMessage({
        id,
        ok: false,
        error: e && e.message ? e.message : String(e),
        result: {},
      });
    }
  });
}
