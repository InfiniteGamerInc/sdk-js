import { CLIP_LIMITS } from "@infinitegamer/protocol/limits";
import type { Clip, ClipRecordOptions, ClipRecording } from "./types.ts";

/*
 * The gameplay clip recorder: canvas.captureStream() into MediaRecorder. Lazy like the room client: the CDN
 * build loads it as `ig.clips.global.js` on the first `IG.clips.record` call, so it must not import runtime
 * code from the core (that would duplicate it); errors come in through ClipDeps.
 */

/** The subset of the MediaRecorder constructor the recorder uses. */
export interface RecorderClass {
  new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder;
  isTypeSupported(type: string): boolean;
}

export interface ClipDeps {
  error(code: string, message: string): Error;
}

/** Preferred containers, best first. Safari records only MP4; the rest prefer WebM. */
const TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
];

/** The first container this browser can record, or `undefined`. */
export function pickMimeType(recorder: Pick<RecorderClass, "isTypeSupported">): string | undefined {
  return TYPES.find((t) => recorder.isTypeSupported(t));
}

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(n) ? n : max));

export function record(options: ClipRecordOptions, deps: ClipDeps): ClipRecording {
  const canvas = options?.canvas;
  if (!canvas || typeof canvas.captureStream !== "function") {
    throw deps.error("bad_request", "clips.record needs a canvas element");
  }
  const Recorder = (globalThis as { MediaRecorder?: RecorderClass }).MediaRecorder;
  const mimeType = Recorder && pickMimeType(Recorder);
  if (!Recorder || !mimeType) throw deps.error("feature_unavailable", "This browser can't record video");

  const maxSeconds = clamp(options.maxSeconds ?? CLIP_LIMITS.defaultSeconds, 1, CLIP_LIMITS.maxSeconds);
  const stream = canvas.captureStream(clamp(options.fps ?? 30, 1, CLIP_LIMITS.maxFps));
  // The game's audio tracks are added, not owned: stopping the recording only stops the canvas track.
  for (const track of options.audio?.getAudioTracks() ?? []) stream.addTrack(track);
  const recorder = new Recorder(stream, {
    mimeType,
    videoBitsPerSecond: options.videoBitsPerSecond ?? 2_500_000,
  });

  const chunks: Blob[] = [];
  let bytes = 0;
  let canceled = false;
  const started = Date.now();
  const halt = () => {
    if (recorder.state !== "inactive") recorder.stop();
  };
  const timer = setTimeout(halt, maxSeconds * 1000);
  const done = new Promise<Clip>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.push(e.data);
      bytes += e.data.size;
      if (bytes >= CLIP_LIMITS.maxBytes * 0.95) halt();
    };
    recorder.onerror = () => reject(deps.error("internal", "Recording failed"));
    recorder.onstop = () => {
      clearTimeout(timer);
      for (const track of stream.getVideoTracks()) track.stop();
      if (canceled) return reject(deps.error("bad_request", "The recording was canceled"));
      resolve({
        blob: new Blob(chunks, { type: mimeType.split(";")[0] }),
        mimeType,
        durationMs: Date.now() - started,
      });
    };
  });
  done.catch(() => {});
  recorder.start(1000);

  return {
    get recording() {
      return recorder.state === "recording";
    },
    stop: () => {
      halt();
      return done;
    },
    cancel: () => {
      canceled = true;
      halt();
    },
  };
}
