// CTIA standard keyword sets (TCPA / carrier requirements). Only the bare
// keyword opts in/out — "stop the invoice" is a normal message, not an opt-out.
const STOP = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const HELP = new Set(['HELP', 'INFO']);
const START = new Set(['START', 'YES', 'UNSTOP']);

const norm = (t: string) => t.trim().toUpperCase();

export function isStopKeyword(text: string): boolean { return STOP.has(norm(text)); }
export function isHelpKeyword(text: string): boolean { return HELP.has(norm(text)); }
export function isStartKeyword(text: string): boolean { return START.has(norm(text)); }

// Shown at opt-in (the connect flow records this consent — see the checklist).
export const SMS_CONSENT_COPY =
  'Your grove can text you about things that need you — like approving a draft. Message frequency varies. ' +
  'Message and data rates may apply. Reply HELP for help, STOP to opt out anytime.';

export const SMS_HELP_REPLY =
  'Nibbin: your grove texts you when something needs you. Reply STOP to opt out. More in the app at nibbin.com/app.';

export const SMS_STOP_REPLY =
  'You\'ve opted out — your grove won\'t text this number again. You can still reach it in the app, and reply START here to turn texts back on.';
