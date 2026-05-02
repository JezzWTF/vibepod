export const SAMPLE_RATE = 24_000;

export function decodeFloat32Chunk(data: string): Float32Array<ArrayBuffer> {
  const raw = atob(data);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer as ArrayBuffer);
}

export function mergeFloat32Arrays(
  chunks: Float32Array<ArrayBuffer>[]
): Float32Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Builds a float32 RIFF/WAV Blob from raw PCM samples. */
export function buildWav(
  samples: Float32Array<ArrayBuffer>,
  sampleRate: number
): Blob {
  const dataSize = samples.length * 4;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); // PCM float32
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); // byte rate
  view.setUint16(32, 4, true); // block align
  view.setUint16(34, 32, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  new Float32Array(buffer, 44).set(samples);

  return new Blob([buffer], { type: "audio/wav" });
}
