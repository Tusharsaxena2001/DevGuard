/** Injection token for the validated `Env`. Provided once by `AppModule`; no module reads `process.env` directly. */
export const ENV = Symbol("ENV");
