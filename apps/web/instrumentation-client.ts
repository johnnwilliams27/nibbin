import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  // Replay is error-only and fully masked: no ambient session recording, and the
  // default maskAllText/blockAllMedia stays on so member content never reaches
  // Sentry in the clear. sendDefaultPii stays at its false default for the same
  // reason.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration()],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
