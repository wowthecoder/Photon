import type { Attachment } from "./store";

export const attachmentUrl = (a: Attachment) => `photon-image://attachment/${a.name}`;

// what llama-server can decode: images via stb_image (we always send PNG), audio via miniaudio
const AUDIO_TYPES: Record<string, string> = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/flac": "flac", "audio/x-flac": "flac" };
export const AUDIO_ACCEPT = ".mp3,.wav,.flac,audio/mpeg,audio/wav,audio/flac";
const MAX_SIDE = 2048;

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.readAsDataURL(blob);
  });

// Re-encode as PNG: covers formats llama-server can't read (WebP, AVIF) and caps very large photos.
async function toPng(file: Blob) {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Photon can't read this image. Try a PNG or JPEG.");
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/png" });
}

export async function saveAttachment(file: File): Promise<Attachment> {
  const id = crypto.randomUUID();
  if (file.type.startsWith("image/")) {
    const name = `${id}.png`;
    await window.photon!.saveAttachment(name, await toBase64(await toPng(file)));
    return { name, kind: "image", label: file.name || "Pasted image" };
  }
  const ext = AUDIO_TYPES[file.type] ?? /\.(mp3|wav|flac)$/i.exec(file.name)?.[1].toLowerCase();
  if (!ext) throw new Error(file.type.startsWith("audio/") ? "Photon can attach MP3, WAV or FLAC audio." : `Photon can't attach ${file.name || "this file"}.`);
  const name = `${id}.${ext}`;
  await window.photon!.saveAttachment(name, await toBase64(file));
  return { name, kind: "audio", label: file.name };
}

// OpenAI-style content part for llama-server's /v1/chat/completions
export async function attachmentPart(a: Attachment) {
  const data = await window.photon!.readAttachment(a.name);
  return a.kind === "image"
    ? { type: "image_url", image_url: { url: `data:image/png;base64,${data}` } }
    : { type: "input_audio", input_audio: { data, format: a.name.split(".").pop() } };
}
