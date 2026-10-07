import { NoiseType } from '../data/schema';
import { audio } from './alerts';

/**
 * Šum na soustředění generovaný přímo v prohlížeči (žádné soubory).
 * Hnědý = hluboký (jako vodopád), růžový = vyvážený (jako déšť), bílý = ostrý (jako TV šum).
 */

const LOOP_SEC = 12;
const XFADE_SEC = 1;

const cache = new Map<NoiseType, AudioBuffer>();
let source: AudioBufferSourceNode | null = null;
let gain: GainNode | null = null;
let playing: NoiseType = 'off';

function generate(ctx: AudioContext, type: NoiseType): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = LOOP_SEC * rate;
  const fade = XFADE_SEC * rate;
  const raw = new Float32Array(len + fade);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    if (type === 'white') raw[i] = w * 0.5;
    else if (type === 'pink') {
      // Paul Kellet – refined pink noise
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      raw[i] = last * 3.5;
    }
  }
  // Bezešvá smyčka: konec plynule přechází do začátku.
  const buf = ctx.createBuffer(1, len, rate);
  const out = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    if (i < fade) {
      const t = i / fade;
      out[i] = raw[i] * t + raw[len + i] * (1 - t);
    } else out[i] = raw[i];
  }
  return buf;
}

export function startNoise(type: NoiseType, volume: number) {
  if (type === 'off') return stopNoise();
  const ctx = audio();
  if (!ctx) return;
  if (playing === type && gain) {
    setNoiseVolume(volume);
    return;
  }
  stopNoise(0.3);
  let buf = cache.get(type);
  if (!buf) {
    buf = generate(ctx, type);
    cache.set(type, buf);
  }
  source = ctx.createBufferSource();
  source.buffer = buf;
  source.loop = true;
  gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(volume * 0.5, ctx.currentTime + 1.5);
  source.connect(gain).connect(ctx.destination);
  source.start();
  playing = type;
}

export function stopNoise(fadeSec = 0.8) {
  const ctx = audio();
  if (!ctx || !source || !gain) {
    playing = 'off';
    return;
  }
  const s = source;
  const g = gain;
  g.gain.cancelScheduledValues(ctx.currentTime);
  g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
  g.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeSec);
  s.stop(ctx.currentTime + fadeSec + 0.05);
  source = null;
  gain = null;
  playing = 'off';
}

export function setNoiseVolume(volume: number) {
  const ctx = audio();
  if (!ctx || !gain) return;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.linearRampToValueAtTime(volume * 0.5, ctx.currentTime + 0.15);
}

export const NOISE_LABEL: Record<NoiseType, string> = {
  off: 'Vypnuto',
  brown: 'Hnědý',
  pink: 'Růžový',
  white: 'Bílý',
};
