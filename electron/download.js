import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

// Downloads url to dest via dest.part, resuming from whatever the .part file already holds.
// Calls onProgress(done) as bytes arrive. Rejects on abort (keeping the .part) or on a size mismatch.
export async function download({ url, dest, size, signal, onProgress = () => {} }) {
  const part = `${dest}.part`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let done = fs.existsSync(part) ? fs.statSync(part).size : 0;

  if (done !== size) {
    const res = await fetch(url, { headers: done ? { Range: `bytes=${done}-` } : {}, signal });
    if (res.status === 200) done = 0; // server ignored the range: start over
    else if (res.status !== 206) throw new Error(`Download failed (HTTP ${res.status})`);
    onProgress(done);

    const out = fs.createWriteStream(part, { flags: done ? "a" : "w" });
    try {
      for await (const chunk of Readable.fromWeb(res.body)) {
        if (!out.write(chunk)) await once(out, "drain");
        onProgress((done += chunk.length));
      }
    } finally {
      out.end();
      await once(out, "close");
    }
  }

  if (done < size) throw new Error("The connection closed early. Resume to continue.");
  if (done > size) {
    fs.rmSync(part, { force: true });
    throw new Error(`Download was ${done} bytes, expected ${size}. Try again.`);
  }
  fs.renameSync(part, dest);
}
