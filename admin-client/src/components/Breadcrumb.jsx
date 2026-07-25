import { Link } from 'react-router-dom';

// crumbs: [{ label, to }] — last item renders as plain text (current level)
export default function Breadcrumb({ crumbs }) {
  return (
    <div className="breadcrumb">
      {crumbs.map((c, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {i > 0 && <span className="sep">/</span>}
          {i === crumbs.length - 1 ? (
            <span className="current">{c.label}</span>
          ) : (
            <Link to={c.to}>{c.label}</Link>
          )}
        </span>
      ))}
    </div>
  );
}
