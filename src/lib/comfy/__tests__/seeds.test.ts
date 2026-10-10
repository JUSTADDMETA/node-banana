import { describe, it, expect, vi, afterEach } from "vitest";

import { initialSeedValues, nextSeed, seedsForRun } from "../seeds";
import type { ComfyAppParam } from "../types";

const seed = (over: Partial<ComfyAppParam> = {}): ComfyAppParam => ({
  id: "25:noise_seed",
  label: "Noise Seed",
  nodeId: "25",
  inputKey: "noise_seed",
  type: "integer",
  isSeed: true,
  default: 342971778941390,
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("nextSeed", () => {
  it("keeps a fixed seed, steps the others, and draws a new random one", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(nextSeed(41, "fixed", {})).toBe(41);
    expect(nextSeed(41, "increment", {})).toBe(42);
    expect(nextSeed(41, "decrement", {})).toBe(40);
    expect(nextSeed(41, "random", {})).toBe(2 ** 30);
  });

  it("wraps at either end, and never steps past what a JS number holds exactly", () => {
    expect(nextSeed(9, "increment", { minimum: 0, maximum: 9 })).toBe(0);
    expect(nextSeed(0, "decrement", { minimum: 0, maximum: 9 })).toBe(9);
    // Graphs declare 0xffffffffffffffff as a seed's maximum.
    expect(nextSeed(0, "decrement", { maximum: 18446744073709551615 })).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("initialSeedValues", () => {
  it("chooses a seed for every exposed seed, and nothing for other settings", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.25);
    const values = initialSeedValues([seed(), { ...seed({ id: "31:steps", isSeed: false }), default: 20 }]);
    expect(values).toEqual({ "25:noise_seed": 2 ** 29 });
  });

  it("starts a seed that is not random from the workflow's own", () => {
    expect(initialSeedValues([seed()], { "25:noise_seed": "fixed" })).toEqual({ "25:noise_seed": 342971778941390 });
  });
});

describe("seedsForRun", () => {
  it("runs the value the node shows and moves it on by its mode", () => {
    const { run, after } = seedsForRun([seed()], { "25:noise_seed": 7, "31:steps": 20 }, { "25:noise_seed": "increment" });
    expect(run).toEqual({ "25:noise_seed": 7, "31:steps": 20 });
    expect(after).toEqual({ "25:noise_seed": 8 });
  });

  it("starts a seed with no value where a new node would", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(seedsForRun([seed()], {}).run).toEqual({ "25:noise_seed": 2 ** 30 });
    expect(seedsForRun([seed()], {}, { "25:noise_seed": "fixed" }).run).toEqual({ "25:noise_seed": 342971778941390 });
  });

  it("leaves a workflow with no exposed seed alone", () => {
    expect(seedsForRun([{ ...seed(), isSeed: false }], { "25:noise_seed": 3 })).toEqual({ run: { "25:noise_seed": 3 }, after: {} });
  });
});
