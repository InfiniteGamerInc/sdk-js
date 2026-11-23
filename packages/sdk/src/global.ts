import { IgError } from "@infinitegamer/protocol/errors";
import { IgClient, clipsRuntime, connectedRuntime, createClient, mockRuntime, roomRuntime, stageRuntime } from "./client.ts";
import { SDK_VERSION } from "./version.ts";

/*
 * CDN build: `<script src=".../ig.global.js">` defines `window.IG`, the same client the npm package exports
 * as `IG`, plus `IG.createClient`, `IG.IgError`, and `IG.version`. The room client, the clip recorder, the
 * stage client, mock mode, and connected mode stay out of this bundle: `ig.multiplayer.global.js`,
 * `ig.clips.global.js`, `ig.stage.global.js`, `ig.mock.global.js`, and `ig.connected.global.js`, next to this
 * script, load on the first `IG.multiplayer`, `IG.clips.record`, and `IG.stage.watch` calls, and when the game
 * runs outside the platform (connected mode when `init()` gets a `gameId`).
 */
const scope = globalThis as unknown as Record<string, unknown>;
const src = typeof document === "undefined" ? undefined : (document.currentScript as HTMLScriptElement | null)?.src;
const loading: Record<string, Promise<never> | undefined> = {};

/**
 * Loads `ig.<name>.global.js` once; it assigns `globalThis.__ig<name>`. Next to this script first, then from the
 * CDN, for games that copied only `ig.global.js` into their project.
 */
const chunk = <T>(name: string): Promise<T> => {
  const file = `ig.${name}.global.js`;
  const urls = [`https://cdn.jsdelivr.net/npm/@infinitegamer/sdk@${SDK_VERSION}/dist/${file}`];
  if (src?.endsWith(".js")) urls.unshift(new URL(file, src).href);
  const load = (i: number): Promise<never> =>
    new Promise<never>((resolve, reject) => {
      const key = "__ig" + name;
      const script = document.createElement("script");
      script.src = urls[i]!;
      const fail = () => {
        script.remove();
        if (urls[i + 1]) return load(i + 1).then(resolve, reject);
        loading[name] = undefined;
        reject(new IgError("internal", `Couldn't load ${script.src}`));
      };
      script.onload = () => (scope[key] ? resolve(scope[key] as never) : fail());
      script.onerror = fail;
      document.head.append(script);
    });
  return (loading[name] ??= load(0));
};

roomRuntime.load = () => chunk("multiplayer");
clipsRuntime.load = () => chunk("clips");
stageRuntime.load = () => chunk("stage");
mockRuntime.load = () => chunk("mock");
connectedRuntime.load = () => chunk("connected");

if (!scope.IG) scope.IG = Object.assign(new IgClient(), { createClient, IgError, version: SDK_VERSION });
