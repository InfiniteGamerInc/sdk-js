/**
 * Test helpers: a fake shell window and game window wired together like a page and its iframe, with
 * browser-like `postMessage` (structured clone, async delivery, messages for the wrong `targetOrigin`
 * dropped, real `source` and `origin` on every event). Works in happy-dom and plain Node.
 */

export interface PostedMessage {
  data: unknown;
  targetOrigin: string;
  delivered: boolean;
}

export class FakeWindow extends EventTarget {
  parent: FakeWindow = this;
  readonly location: {
    href: string;
    origin: string;
    ancestorOrigins?: { length: number; [index: number]: string };
  };
  /** Everything posted to this window, delivered or not. */
  readonly received: PostedMessage[] = [];
  /** The window whose code calls this window's `postMessage` (the other side of the pair). */
  peer: FakeWindow | null = null;
  readonly localStorage = globalThis.localStorage;
  readonly navigator = globalThis.navigator;
  readonly document = globalThis.document;
  readonly performance = globalThis.performance;
  fetch: typeof globalThis.fetch | undefined = globalThis.fetch?.bind(globalThis);

  constructor(href: string) {
    super();
    const url = new URL(href);
    this.location = { href: url.href, origin: url.origin };
  }

  get origin(): string {
    return this.location.origin;
  }

  postMessage(data: unknown, targetOrigin: string): void {
    const delivered = targetOrigin === "*" || targetOrigin === this.origin;
    this.received.push({ data, targetOrigin, delivered });
    if (!delivered || !this.peer) return;
    const source = this.peer;
    const cloned = structuredClone(data);
    queueMicrotask(() => deliver(this, { data: cloned, origin: source.origin, source }));
  }
}

/** Dispatches a `message` event as if `source` (at `origin`) had posted it. Use it to fake messages from strangers. */
export function deliver(
  target: EventTarget,
  init: { data: unknown; origin: string; source: unknown },
): void {
  const event = new Event("message");
  Object.defineProperties(event, {
    data: { value: init.data },
    origin: { value: init.origin },
    source: { value: init.source },
  });
  target.dispatchEvent(event);
}

export interface WindowPair {
  /** The shell page, as the host side of the bridge sees `window`. */
  shell: FakeWindow & Window;
  /** The game page in the iframe. Pass as `window` to the SDK's `createClient`. */
  game: FakeWindow & Window;
  /** The `<iframe>` holding the game, as the shell sees it. */
  iframe: HTMLIFrameElement;
}

/** A shell page at `shellUrl` framing a game page at `gameUrl`. */
export function createWindowPair({
  shellUrl,
  gameUrl,
}: {
  shellUrl: string;
  gameUrl: string;
}): WindowPair {
  const shell = new FakeWindow(shellUrl);
  const game = new FakeWindow(gameUrl);
  game.parent = shell;
  shell.peer = game;
  game.peer = shell;
  const iframe = { contentWindow: game, src: gameUrl } as unknown as HTMLIFrameElement;
  return { shell: shell as FakeWindow & Window, game: game as FakeWindow & Window, iframe };
}

/** Resolves after queued `postMessage` deliveries (and the promise work they start) have run. */
export async function flushMessages(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => queueMicrotask(resolve));
}
