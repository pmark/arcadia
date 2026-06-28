/**
 * API seam for Arcadia Intelligence v0.1.
 *
 * Required endpoints:
 * - POST /api/intelligence/jobs
 * - GET /api/intelligence/jobs/:jobId
 * - POST /api/intelligence/jobs/:jobId/retry
 * - GET /api/intelligence/health
 *
 * Codex should implement this using the existing Arcadia HTTP framework or
 * Fastify if no stronger repository convention already exists.
 *
 * Do not add generic chat, provider, model-selection, admin, or prompt-playground
 * endpoints.
 */
export const intelligenceApiRoutes = {
  submitJob: "POST /api/intelligence/jobs",
  getJob: "GET /api/intelligence/jobs/:jobId",
  retryJob: "POST /api/intelligence/jobs/:jobId/retry",
  health: "GET /api/intelligence/health",
} as const;
