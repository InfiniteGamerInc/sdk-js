/**
 * The Infinite Gamer SDK: lifecycle, player identity, cloud saves, leaderboards, achievements, analytics,
 * and feedback for web games published on Infinite Gamer. Outside the Infinite Gamer shell it runs in
 * mock mode, so games work with their usual dev server, or, with `init({ gameId })`, in connected mode, so games on
 * their own sites get the same services with "Sign in with Infinite Gamer".
 *
 * @example
 * ```ts
 * import { IG } from "@infinitegamer/sdk";
 *
 * await IG.init();
 * IG.ready();
 * IG.on("pause", () => game.pause());
 * await IG.storage.set("progress", { level: 4 });
 * await IG.leaderboards.submit("daily", 1280);
 * ```
 *
 * @packageDocumentation
 */
import { IgClient, connectedRuntime, mockRuntime, roomRuntime } from "./client.ts";

roomRuntime.load ??= () => import("./room.ts");
mockRuntime.load ??= () => import("./mock.ts");
connectedRuntime.load ??= () => import("./connected.ts");

export { IgClient, createClient } from "./client.ts";
export type {
  AchievementsModule,
  AdsModule,
  AnalyticsModule,
  ClipsModule,
  FeedbackModule,
  FriendsModule,
  LeaderboardsModule,
  MatchesModule,
  MultiplayerModule,
  PaymentsModule,
  PlayerModule,
  RemoteConfigModule,
  StageModule,
  StorageModule,
} from "./client.ts";
export type { AudioModule } from "./audio.ts";
export type { MockControls } from "./mock.ts";
export type * from "./types.ts";
export { SDK_VERSION } from "./version.ts";
export { IgError, ERROR_CODES, type ErrorCode } from "@infinitegamer/protocol/errors";

/** The shared SDK client. Import it and call {@link IgClient.init}, or just start calling methods. */
export const IG: IgClient = /* @__PURE__ */ new IgClient();
