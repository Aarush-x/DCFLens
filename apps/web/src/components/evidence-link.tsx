type EvidenceLinkProps = { evidenceId: string; href: string; children?: string };

export function EvidenceLink({ evidenceId, href, children = "View source evidence" }: EvidenceLinkProps) {
  return (
    <a
      className="evidence-link"
      href={href}
      rel="noreferrer"
      target="_blank"
      aria-label={`${children}: ${evidenceId} (opens in a new tab)`}
    >
      <span>{children}</span>
      <span className="evidence-link__id">{evidenceId}</span>
    </a>
  );
}
