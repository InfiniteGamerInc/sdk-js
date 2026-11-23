import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IgError, createClient, type IgClient } from "../src/index.ts";
import "../src/clips-entry.ts";
import { pickMimeType } from "../src/clips.ts";

/** A MediaRecorder stand-in: emits one chunk a second while recording, and a last one on stop. */
class FakeRecorder {
  static supported = ["video/webm;codecs=vp9,opus", "video/webm"];
  static isTypeSupported = (t: string) => FakeRecorder.supported.includes(t);
  static last: FakeRecorder | null = null;
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(
    readonly stream: FakeStream,
    readonly options: MediaRecorderOptions,
  ) {
    FakeRecorder.last = this;
  }
  start(timeslice: number) {
    this.state = "recording";
    this.timer = setInterval(() => this.ondataavailable?.({ data: new Blob(["x".repeat(10)]) }), timeslice);
  }
  stop() {
    clearInterval(this.timer);
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["end"]) });
    this.onstop?.();
  }
}

class FakeTrack {
  stopped = false;
  constructor(readonly kind: "audio" | "video") {}
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  tracks: FakeTrack[] = [new FakeTrack("video")];
  addTrack(t: FakeTrack) {
    this.tracks.push(t);
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
}

const canvas = () =>
  ({ captureStream: vi.fn((fps: number) => Object.assign(new FakeStream(), { fps })) }) as unknown as HTMLCanvasElement;

let client: IgClient;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  client = createClient();
  await client.init({ mock: { quiet: true } });
});

afterEach(() => {
  client.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("IG.clips", () => {
  it("picks the best container the browser supports", () => {
    expect(pickMimeType(FakeRecorder)).toBe("video/webm;codecs=vp9,opus");
    expect(pickMimeType({ isTypeSupported: (t) => t.startsWith("video/mp4") })).toBe("video/mp4;codecs=avc1,mp4a");
    expect(pickMimeType({ isTypeSupported: () => false })).toBeUndefined();
  });

  it("records a canvas until stop()", async () => {
    const c = canvas();
    const recording = await client.clips.record({ canvas: c, fps: 120 });
    expect(c.captureStream).toHaveBeenCalledWith(60);
    expect(recording.recording).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    const clip = await recording.stop();
    expect(recording.recording).toBe(false);
    expect(clip.mimeType).toBe("video/webm;codecs=vp9,opus");
    expect(clip.blob.type).toBe("video/webm");
    expect(clip.blob.size).toBe(33);
    expect(clip.durationMs).toBe(3000);
    expect(FakeRecorder.last?.stream.getVideoTracks()[0]?.stopped).toBe(true);
  });

  it("stops on its own at maxSeconds and keeps the game's audio tracks running", async () => {
    const audio = new FakeStream();
    audio.tracks = [new FakeTrack("audio")];
    const recording = await client.clips.record({
      canvas: canvas(),
      maxSeconds: 5,
      audio: audio as unknown as MediaStream,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(recording.recording).toBe(false);
    expect((await recording.stop()).durationMs).toBe(5000);
    expect(FakeRecorder.last?.stream.getAudioTracks()).toHaveLength(1);
    expect(audio.tracks[0]?.stopped).toBe(false);
  });

  it("rejects stop() after cancel()", async () => {
    const recording = await client.clips.record({ canvas: canvas() });
    recording.cancel();
    await expect(recording.stop()).rejects.toMatchObject({ code: "bad_request" });
  });

  it("explains when recording isn't possible", async () => {
    await expect(client.clips.record({} as never)).rejects.toBeInstanceOf(IgError);
    vi.stubGlobal("MediaRecorder", undefined);
    await expect(client.clips.record({ canvas: canvas() })).rejects.toMatchObject({ code: "feature_unavailable" });
  });

  it("share() is answered by mock mode without a share sheet", async () => {
    const clip = { blob: new Blob(["v"], { type: "video/webm" }), mimeType: "video/webm", durationMs: 1000 };
    await expect(client.clips.share(clip, { text: "New best!" })).resolves.toEqual({ shared: false });
  });
});
