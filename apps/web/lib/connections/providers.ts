export interface ConnectableProvider {
  id: string;
  label: string;
  wired: boolean; // false → shown as "Coming soon", non-interactive
}

export const CONNECTABLE_PROVIDERS: ConnectableProvider[] = [
  { id: 'gmail', label: 'Gmail', wired: true },
  { id: 'google-calendar', label: 'Google Calendar', wired: false },
  { id: 'stripe', label: 'Stripe', wired: false },
];
