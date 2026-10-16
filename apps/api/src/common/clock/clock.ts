/** Injected wherever the API needs "now", so expiry logic is deterministic in tests. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol("CLOCK");

export const systemClock: Clock = { now: () => new Date() };
