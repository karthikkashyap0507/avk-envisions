/**
 * Server bootstrap.
 *
 * Next.js calls `register()` once per server process, before any request is
 * handled. Validating configuration here means a misconfigured deployment
 * fails loudly at startup with every problem listed, rather than surfacing as
 * an opaque 500 the first time some unrelated request happens to touch the
 * setting.
 */
export async function register() {
  // Kannada translation runs in the background for the life of the server:
  // on-demand requests first, then the untranslated backlog. It waits quietly
  // when the local engine is not running. Inside an explicit NEXT_RUNTIME
  // check, which the bundler removes for the edge build - an early return
  // does not, and the edge build cannot bundle the worker.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startTranslationWorker } = await import('@/server/translation/worker');
    startTranslationWorker();
  }

  // Guard against the edge runtime, where neither Prisma nor pino can load.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { configWarnings, serverEnv } = await import('@/lib/env');
  const { logger } = await import('@/server/logger');

  try {
    const env = serverEnv();

    for (const warning of configWarnings()) {
      logger.warn({ scope: 'config' }, warning);
    }

    // WAL mode and a busy timeout are what let concurrent readers proceed
    // during a submission burst; without them SQLite serialises everything and
    // returns SQLITE_BUSY under load.
    const { applySqlitePragmas } = await import('@/server/db');
    const pragmas = await applySqlitePragmas();
    if (pragmas.failed.length > 0) {
      // Tuning, not correctness — log loudly but keep serving.
      logger.error({ failed: pragmas.failed }, 'Some SQLite pragmas could not be applied');
    }

    logger.info(
      {
        env: env.NODE_ENV,
        database: env.DATABASE_URL.startsWith('file:') ? 'sqlite' : 'remote',
        storage: env.STORAGE_DRIVER,
        email: env.EMAIL_PROVIDER,
        ai: env.AI_PROVIDER,
        payments: Boolean(env.RAZORPAY_KEY_ID),
      },
      'AVK Envisions server ready',
    );
  } catch (error) {
    // Configuration errors must not be swallowed — print and re-throw so the
    // process exits instead of serving traffic in a broken state.
    console.error('\n[AVK Envisions] Startup failed.\n');
    console.error(error instanceof Error ? error.message : error);
    console.error('\nCheck your .env against .env.example.\n');
    throw error;
  }
}
