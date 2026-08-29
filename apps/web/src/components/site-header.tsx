import Link from "next/link";

const links = [
  { href: "/analysis", label: "Fixture analyses" },
  { href: "/#method", label: "Method" },
  { href: "/#evidence", label: "Evidence" },
] as const;

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="page-grid site-header__inner">
        <Link className="wordmark" href="/" aria-label="DCFLens home">DCF<span>Lens</span></Link>
        <nav aria-label="Primary navigation">
          <ul className="nav-list">
            {links.map((link) => <li key={link.href}><Link href={link.href}>{link.label}</Link></li>)}
          </ul>
        </nav>
        <Link className="header-action" href="/analysis/AAPL">Open an analysis</Link>
      </div>
    </header>
  );
}
