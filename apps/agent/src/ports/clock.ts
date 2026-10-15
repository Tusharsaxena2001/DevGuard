/** Current time, injected so logic and tests never read the wall clock directly. */
export interface Clock {
  now(): Date;
}
