import AaLogo from './AaLogo';

// Brand strip pinned to the agent app (rendered from router.jsx only for
// agent sessions). Sticky so it never scrolls away but keeps its own row in
// the document flow — no page content hides behind it.
export default function TopBar() {
  return (
    <header className="top-brand">
      <AaLogo size={30} />
      <span className="top-brand-name">Action Alliance</span>
      <span className="top-brand-sub">Result Portal</span>
    </header>
  );
}