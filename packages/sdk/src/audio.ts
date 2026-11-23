import type { AudioTarget } from "./types.ts";

/** Follows the shell's pause and mute for registered audio. See {@link IgClient.audio}. */
export interface AudioModule {
  /**
   * Let the SDK silence this audio on `pause` and `mute`, and bring it back on `resume` and `unmute`.
   * An `AudioContext` is suspended and resumed; a media element is muted and paused.
   * Audio the game paused or muted itself is left alone.
   *
   * @returns A function that unregisters the target.
   */
  register(target: AudioTarget): () => void;
}

interface Tracked {
  target: AudioTarget;
  suspendedBySdk: boolean;
  pausedBySdk: boolean;
  mutedBySdk: boolean;
}

function isAudioContext(target: AudioTarget): target is AudioContext {
  return typeof (target as AudioContext).suspend === "function";
}

export class AudioController implements AudioModule {
  private readonly tracked = new Set<Tracked>();

  constructor(private readonly state: () => { muted: boolean; paused: boolean }) {}

  register(target: AudioTarget): () => void {
    const entry: Tracked = { target, suspendedBySdk: false, pausedBySdk: false, mutedBySdk: false };
    this.tracked.add(entry);
    this.apply(entry);
    return () => void this.tracked.delete(entry);
  }

  update(): void {
    for (const entry of this.tracked) this.apply(entry);
  }

  private apply(entry: Tracked): void {
    const { muted, paused } = this.state();
    const { target } = entry;
    if (isAudioContext(target)) {
      const silence = muted || paused;
      if (silence && target.state === "running") {
        entry.suspendedBySdk = true;
        void target.suspend().catch(() => undefined);
      } else if (!silence && entry.suspendedBySdk) {
        entry.suspendedBySdk = false;
        void target.resume().catch(() => undefined);
      }
      return;
    }
    if (muted && !target.muted) {
      target.muted = true;
      entry.mutedBySdk = true;
    } else if (!muted && entry.mutedBySdk) {
      target.muted = false;
      entry.mutedBySdk = false;
    }
    if (paused && !target.paused) {
      target.pause();
      entry.pausedBySdk = true;
    } else if (!paused && entry.pausedBySdk) {
      entry.pausedBySdk = false;
      void target.play().catch(() => undefined);
    }
  }
}
