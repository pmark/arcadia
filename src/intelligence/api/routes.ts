/**
 * Documents the four v0.1 routes. The actual HTTP server is
 * ./server.ts (plain node:http; see that file for why Fastify wasn't added).
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
