/**
 * Shared marketing footer. Mirrors SiteNav: same markup on the landing page and
 * /about. Section links are same-page anchors on home, landing anchors elsewhere.
 */
export function SiteFooter({ home = false }: { home?: boolean }) {
  const a = home ? '' : '/';
  return (
    <footer>
      <div className="wrap foot-in">
        <span>© 2026 Nibbin · hello@nibbin.com</span>
        <div className="foot-links">
          <a href={`${a}#how`}>How it works</a>
          <a href={`${a}#pricing`}>Pricing</a>
          <a href="mailto:hello@nibbin.com">Contact</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/data-ai">Data &amp; AI</a>
          <a href="/subprocessors">Subprocessors</a>
        </div>
      </div>
    </footer>
  );
}
