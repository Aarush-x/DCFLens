const links = [
  { href: "#method", label: "Method" },
  { href: "#evidence", label: "Evidence" },
  { href: "#checklist", label: "Checklist" },
] as const;

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="page-grid site-header__inner">
        <a className="wordmark" href="#top" aria-label="DCFLens home">DCF<span>Lens</span></a>
        <nav aria-label="Primary navigation">
          <ul className="nav-list">
            {links.map((link) => <li key={link.href}><a href={link.href}>{link.label}</a></li>)}
          </ul>
        </nav>
        <a className="header-action" href="#analyze">Enter ticker</a>
      </div>
    </header>
  );
}
