/**
 * A link with its key, the fragment, shown apart from the rest, which makes visible what
 * never reaches the server. One click selects the whole link. It wraps instead of
 * truncating, so the key at its end always stays visible.
 */
export function SplitLink({ link, label }: { link: string; label: string }) {
  const hashIndex = link.indexOf("#");
  const base = hashIndex >= 0 ? link.slice(0, hashIndex) : link;
  const key = hashIndex >= 0 ? link.slice(hashIndex) : "";
  return (
    <p
      aria-label={label}
      className="min-w-0 flex-1 select-all break-all px-2 py-1.5 font-mono text-[13px] leading-relaxed sm:px-0"
    >
      <span className="text-muted-foreground">{base}</span>
      <span className="font-semibold text-primary-text">{key}</span>
    </p>
  );
}
