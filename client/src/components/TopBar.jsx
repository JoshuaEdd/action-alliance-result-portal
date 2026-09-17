import AaLogo from './AaLogo';

// Persistent brand strip pinned to the top of every page (login, register,
// agent wizard, confirmation, admin). Sticky so it never scrolls away but
// keeps its own row in the document flow — no page content hides behind it.
export default function TopBar() {
  return (
    <header className="top-brand">
      <AaLogo size={30} />
      <span className="top-brand-name">Action Alliance</span>
      <span className="top-brand-sub">Result Portal</span>
    </header>
  );
}