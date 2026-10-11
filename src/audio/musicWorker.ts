/**
 * Renders a song in the background, so the game doesn't stop while the FM
 * chip plays it through (see adlib.ts). Takes the XMI and timbre files and
 * a sample rate; sends back the samples.
 */
import { parseTimbres } from '../formats/timbres';
import { parseXmi } from '../formats/xmi';
import { renderSong } from './adlib';

export interface RenderRequest {
  id: number;
  song: Uint8Array;
  timbres: Uint8Array;
  sampleRate: number;
}

export type RenderReply = { id: number; samples: Float32Array; sampleRate: number } | { id: number; error: string };

self.onmessage = (e: MessageEvent<RenderRequest>) => {
  const { id, song, timbres, sampleRate } = e.data;
  try {
    const r = renderSong(parseXmi(song), parseTimbres(timbres), sampleRate);
    (self as unknown as Worker).postMessage({ id, samples: r.samples, sampleRate: r.sampleRate } satisfies RenderReply, [r.samples.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message } satisfies RenderReply);
  }
};
