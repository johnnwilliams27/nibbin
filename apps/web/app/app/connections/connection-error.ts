export interface ConnectionErrorView {
  title: string;
  body: string;
  action: 'retry' | 'restart' | 'none';
}

export function connectionErrorMessage(code: string): ConnectionErrorView {
  switch (code) {
    case 'declined':
      return {
        title: "You didn't finish connecting",
        body: "The connection was cancelled before it completed. You can try again whenever you're ready.",
        action: 'retry',
      };
    case 'expired':
    case 'invalid_state':
      return {
        title: 'That connection link expired',
        body: 'For your security, connection links are single-use and time-limited. Please start the connection again.',
        action: 'restart',
      };
    case 'exchange_failed':
      return {
        title: "We couldn't complete the connection",
        body: "The provider didn't accept the sign-in. Please try connecting again.",
        action: 'retry',
      };
    case 'save_failed':
      return {
        title: 'Something went wrong on our end',
        body: "We couldn't finish saving your connection. Please try again in a moment.",
        action: 'retry',
      };
    case 'unavailable':
      return {
        title: "That connection isn't available yet",
        body: "This connector isn't ready to connect. Check back soon.",
        action: 'none',
      };
    default:
      return {
        title: "We couldn't complete the connection",
        body: "Please try again. If it keeps happening, reach out and we'll help.",
        action: 'none',
      };
  }
}
