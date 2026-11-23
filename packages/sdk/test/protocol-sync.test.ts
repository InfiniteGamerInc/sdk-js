import * as contracts from "@infinitegamer/protocol";
import type {
  BridgeAchievement,
  BridgeEvent,
  BridgeEventData,
  BridgeNotificationParams,
  BridgeParams,
  BridgePlayer,
  BridgeResult,
  LeaderboardEntry as ContractLeaderboardEntry,
} from "@infinitegamer/protocol";
import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import * as protocol from "../src/protocol.ts";
import { SDK_VERSION, type PaymentsModule } from "../src/index.ts";
import type {
  Achievement,
  AdRequest,
  AdResult,
  AnalyticsProps,
  CreateMatchOptions,
  Entitlement,
  Environment,
  Features,
  FeedbackSubmission,
  Friend,
  IdentityToken,
  IgEventName,
  IgEvents,
  LeaderboardEntry,
  Match,
  MatchmakeOptions,
  MultiplayerTicket,
  PauseReason,
  Player,
  PresenceStatus,
  Product,
  PurchaseResult,
  QuickMatchOptions,
  RemoteConfig,
  RoomEvents,
  RoomInfo,
  RoomLeaveReason,
  RoomPlayer,
  RoomStateEntry,
  SaveKeyInfo,
  ShowLeaderboardOptions,
  SignInResult,
  StageEvents,
  StageRole,
  StageSnapshot,
  StageStatus,
  StageTurnEndReason,
  StageTurnResult,
  SubmitScoreResult,
  TicketRequest,
  TurnSubmission,
  UnlockResult,
} from "../src/index.ts";

/*
 * The SDK's public types are hand-written so its published typings don't depend on Zod. These checks fail
 * `npm run typecheck` when they drift from the bridge schemas in @infinitegamer/protocol.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assignable<A, B> = [A] extends [B] ? true : false;
function check<_T extends true>(): void {}

check<Same<Player, BridgePlayer>>();
check<Same<LeaderboardEntry, ContractLeaderboardEntry>>();
check<Same<Achievement, BridgeAchievement>>();
check<Same<IdentityToken, BridgeResult<"player.identityToken">>>();
check<Same<SignInResult, BridgeResult<"player.signIn">>>();
check<Assignable<ShowLeaderboardOptions & { leaderboard?: string }, BridgeParams<"leaderboards.show">>>();
check<Same<SubmitScoreResult, BridgeResult<"leaderboards.submit">>>();
check<Same<UnlockResult, BridgeResult<"achievements.unlock">>>();
check<Same<SaveKeyInfo, BridgeResult<"storage.list">["keys"][number]>>();
check<Same<Features, BridgeResult<"handshake">["features"]>>();
check<Same<Environment, BridgeResult<"handshake">["environment"]>>();
check<Same<Product, BridgeResult<"payments.catalog">["products"][number]>>();
check<Same<Entitlement, BridgeResult<"payments.entitlements">["entitlements"][number]>>();
check<Same<PurchaseResult, BridgeResult<"payments.purchase">>>();
check<Same<AdResult, BridgeResult<"ads.show">>>();
check<Same<Awaited<ReturnType<PaymentsModule["consume"]>>, BridgeResult<"payments.consume">>>();
check<Same<MultiplayerTicket, BridgeResult<"multiplayer.ticket">>>();
// Stage events go to the `Stage` from `IG.stage.watch()`, not to `IG.on`.
check<Same<IgEventName, Exclude<BridgeEvent, `stage.${string}`>>>();
check<Same<StageStatus, contracts.StageStatus>>();
check<Same<StageSnapshot, contracts.StageSnapshot>>();
check<Same<StageTurnResult, contracts.StageTurnResult>>();
check<Same<StageRole, contracts.StageRole>>();
check<Same<StageTurnEndReason, contracts.StageTurnEndReason>>();
check<Same<StageEvents["role"], BridgeEventData<"stage.role">>>();
check<Same<StageEvents["role"], BridgeResult<"stage.join">>>();
check<Same<StageEvents["position"], BridgeEventData<"stage.position">>>();
check<Same<StageEvents["readyCheck"], BridgeEventData<"stage.readyCheck">>>();
check<Same<Omit<StageEvents["turnStart"], "you">, BridgeEventData<"stage.turnStart">>>();
check<Same<Omit<StageEvents["turnEnd"], "you">, BridgeEventData<"stage.turnEnd">>>();
check<Same<StageEvents["state"], BridgeEventData<"stage.state">>>();
check<Same<StageEvents["viewers"], BridgeEventData<"stage.viewers">>>();
check<Same<PauseReason, BridgeEventData<"pause">["reason"]>>();
check<Same<IgEvents["locale.change"], BridgeEventData<"locale.change">>>();
check<Same<IgEvents["player.change"], BridgeEventData<"player.change">>>();
check<Same<IgEvents["invite"], BridgeEventData<"invite">>>();
check<Assignable<IgEvents["resume"], BridgeEventData<"resume">>>();
check<Same<AnalyticsProps, NonNullable<BridgeNotificationParams<"analytics.track">["props"]>>>();
check<Assignable<AdRequest, BridgeParams<"ads.show">>>();
check<Assignable<TicketRequest, BridgeParams<"multiplayer.ticket">>>();
check<Assignable<FeedbackSubmission, BridgeParams<"feedback.submit">>>();
check<Same<RoomPlayer, contracts.RoomPlayer>>();
check<Same<RoomInfo, contracts.RoomInfo>>();
check<Same<RoomStateEntry, contracts.RoomStateEntry>>();
check<Same<RoomLeaveReason, contracts.RtLeaveReason>>();
check<Same<Match, contracts.Match>>();
check<Same<Friend, contracts.GameFriend>>();
check<Same<PresenceStatus, contracts.PresenceStatus>>();
check<Same<RemoteConfig, BridgeResult<"remoteConfig.get">>>();
check<Assignable<Omit<MatchmakeOptions, "signal">, BridgeParams<"multiplayer.matchmake">>>();
check<Assignable<CreateMatchOptions, BridgeParams<"matches.create">>>();
check<Assignable<QuickMatchOptions, BridgeParams<"matches.quick">>>();
check<Assignable<TurnSubmission & { matchId: string }, BridgeParams<"matches.submitTurn">>>();
check<Same<RoomEvents["state"], Omit<Extract<contracts.RtServerMessage, { t: "state" }>, "t">>>();

describe("protocol sync", () => {
  it("mirrors the bridge constants", () => {
    expect(protocol.BRIDGE_VERSION).toBe(contracts.BRIDGE_VERSION);
    expect(protocol.BRIDGE_TIMEOUT_MS).toBe(contracts.BRIDGE_TIMEOUT_MS);
    expect(protocol.BRIDGE_URL_PARAMS).toEqual(contracts.BRIDGE_URL_PARAMS);
    expect(protocol.BRIDGE_INTERACTIVE_METHODS).toEqual(contracts.BRIDGE_INTERACTIVE_METHODS);
    expect(protocol.TRUSTED_SHELL_ORIGINS).toEqual(contracts.TRUSTED_SHELL_ORIGINS);
  });

  it("uses the analytics name rule from the notification schema", () => {
    const schema = contracts.bridgeNotifications["analytics.track"];
    for (const name of [
      "level_complete",
      "a",
      "a1_b2",
      "Level",
      "1abc",
      "has-dash",
      "has space",
      "",
    ]) {
      expect(protocol.ANALYTICS_EVENT_NAME.test(name), name).toBe(
        schema.safeParse({ name }).success,
      );
    }
  });

  it("reports the package version", () => {
    expect(SDK_VERSION).toBe(pkg.version);
  });

  it("recognizes loopback shells only", () => {
    expect(protocol.isLoopbackOrigin("http://localhost:5173")).toBe(true);
    expect(protocol.isLoopbackOrigin("http://web.localhost:5173")).toBe(true);
    expect(protocol.isLoopbackOrigin("http://127.0.0.1:8080")).toBe(true);
    expect(protocol.isLoopbackOrigin("https://localhost.evil.example")).toBe(false);
    expect(protocol.isLoopbackOrigin("https://example.com")).toBe(false);
    expect(protocol.isLoopbackOrigin("file:///tmp")).toBe(false);
  });
});
