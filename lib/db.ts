import { PrismaClient } from '@prisma/client';

// Log any DB operation that takes longer than this (ms) so slow queries surface
// in the PM2 logs for analysis. Tune with SLOW_QUERY_MS in the env; 0 disables it.
const SLOW_MS = process.env.SLOW_QUERY_MS === undefined ? 500 : Number(process.env.SLOW_QUERY_MS);

// Set to the live client so the extension can persist a slow-query row.
let sink: ExtendedClient | null = null;

function makeClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
  });
  if (!SLOW_MS || SLOW_MS < 0) {
    const plain = base.$extends({ name: 'noop' });
    sink = plain;
    return plain;
  }
  const client = base.$extends({
    name: 'slow-query-timing',
    query: {
      // Times every model call + raw query; logs only the slow ones. We record the
      // model, operation, duration and the top-level arg KEYS (where / orderBy / …)
      // — never the values, so no student data lands in the log.
      async $allOperations({ model, operation, args, query }) {
        // Never time or persist our own sink writes — avoids infinite recursion.
        if (model === 'SlowQueryLog') return query(args);
        const start = performance.now();
        try {
          return await query(args);
        } finally {
          const ms = performance.now() - start;
          if (ms >= SLOW_MS) {
            const keys = args && typeof args === 'object' && !Array.isArray(args) ? Object.keys(args).join(',') : '';
            const durationMs = Math.round(ms);
            console.warn(`[slow-query] ${model ?? 'raw'}.${operation} ${durationMs}ms${keys ? ` (${keys})` : ''}`);
            // Persist for the in-app Slow queries view — fire-and-forget so it never
            // slows the request, and swallow its own errors.
            void sink?.slowQueryLog.create({ data: { model: model ?? null, operation, durationMs, argKeys: keys || null } }).catch(() => {});
          }
        }
      },
    },
  });
  sink = client;
  return client;
}

type ExtendedClient = ReturnType<typeof makeClient>;
const globalForPrisma = global as unknown as { prisma?: ExtendedClient };

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
