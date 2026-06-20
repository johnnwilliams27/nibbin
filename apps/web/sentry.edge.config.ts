import * as Sentry from '@sentry/nextjs';
import { sentryBeforeSend } from '@nibbin/shared/sentry-scrub';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  beforeSend: sentryBeforeSend,
  beforeSendTransaction: sentryBeforeSend,
});
