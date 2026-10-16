/**
 * Path segment of the versioned API. Applied per controller (not via `setGlobalPrefix`, which would scope Nest's
 * JSON 404 handler to /v1 only and leave other unknown paths with Express's HTML 404). `/health` stays unversioned.
 */
export const API_V1 = "v1";
