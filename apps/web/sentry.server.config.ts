import * as Sentry from '@sentry/nextjs';
import { sentryBeforeSend } from '@nibbin/shared/sentry-scrub';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.25,
  beforeSend: sentryBeforeSend,
  beforeSendTransaction: sentryBeforeSend,
});
