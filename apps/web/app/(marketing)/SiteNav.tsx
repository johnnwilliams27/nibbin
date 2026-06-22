import { Wordmark } from './Wordmark';

/**
 * Shared marketing header. One source of truth for the landing page and /about
 * so the two never drift. Relies on the `.landing` nav styles (landing.css), so
 * it must render inside a `.landing` root. On the home page the section links
 * are same-page anchors; elsewhere they point back to the landing anchors.
 */
export function SiteNav({ home = false }: { home?: boolean }) {
  const a = home ? '' : '/';
  return (
    <nav>
      <div className="wrap nav-in">
        <a className="logo" href={home ? '#top' : '/'} aria-label="Nibbin home">
          <Wordmark height={22} />
        </a>
        <div className="nav-links">
          <a href={`${a}#how`}>How it works</a>
          <a href={`${a}#demo`}>Live demo</a>
          <a href={`${a}#privacy`}>Privacy</a>
          <a href={`${a}#pricing`}>Pricing</a>
          <a href="/about">About</a>
          <a href="/login">Login</a>
        </div>
        <div className="nav-right">
          <a className="nav-login" href="/login">
            Login
          </a>
          <a className="nav-cta" href={`${a}#join`}>
            Join the grove
          </a>
        </div>
      </div>
    </nav>
  );
}
