/** Remote avatars are presentation only, not evidence of agent identity. */
export function safeAvatarUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    // Use public DNS names, not local names, credentials, or IP literals.
    // This is a URL policy, not DNS resolution or image-content verification.
    if (url.protocol !== 'https:' || url.username || url.password
      || !host.includes('.') || host.endsWith('.localhost') || host.endsWith('.local')
      || host.endsWith('.internal') || host.startsWith('[') || /^[\d.]+$/.test(host)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function avatarInitials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const first = words[0];
  if (!first) return '—';
  const initials = words.length === 1 ? Array.from(first).slice(0, 2).join('')
    : `${Array.from(first)[0]}${Array.from(words.at(-1) ?? '')[0]}`;
  return Array.from(initials.toUpperCase()).slice(0, 2).join('');
}

export function avatarPresentation(imageUrl: string | null | undefined, name: string, failedUrl: string | null) {
  const src = safeAvatarUrl(imageUrl);
  return { src: src === failedUrl ? null : src, initials: avatarInitials(name) };
}
