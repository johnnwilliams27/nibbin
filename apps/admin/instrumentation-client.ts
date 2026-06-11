import * as Sentry from '@sentry/nextjs';

// No session replay in the staff console: staff screens show member data, and
// prod data never leaves prod (docs/INVARIANTS.md). Errors and traces only.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
