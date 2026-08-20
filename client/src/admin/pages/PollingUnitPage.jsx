import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card, Modal } from '@heroui/react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import Layout from '../components/Layout';
import Breadcrumbs from '../components/Breadcrumbs';
import InviteCodesPanel from '../components/InviteCodesPanel';
import PartyResultsPanel from '../components/PartyResultsPanel';

const PHOTO_LABELS = {
  agent_tag: 'Agent tag',
  result_sheet: 'Result sheet',
  agent_passport: 'Agent passport',
};

// Loads a stored photo through the authenticated API and swaps in a blob
// URL so the image can render without sending the admin token to an <img>.
// The tile is clickable so the admin can inspect the full-size capture —
// including the timestamp + geo-location watermark baked into its corner.
function PhotoTile({ label, token, photo, onOpen }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let revoke;
    if (!photo) return;
    api
      .getPhotoUrl(token, photo.id)
      .then((u) => {
        setUrl(u);
        revoke = u;
      })
      .catch((e) => setError(e.message));
    return () => revoke && URL.revokeObjectURL(revoke);
  }, [token, photo]);

  return (
    <button type="button" className="ph" onClick={() => onOpen && onOpen({ label, url })} disabled={!url || !!error} title={photo ? 'Click to view full size' : undefined}>
      {photo ? (
        error ? (
          <span>{label}\nerror loading photo</span>
        ) : (
          <img src={url} alt={label} />
        )
      ) : (
        `${label}\nnot captured`
      )}
    </button>
  );
}

export default function PollingUnitPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const [pu, setPu] = useState(null);
  const [message, setMessage] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    api
      .getPollingUnitDetail(token, id)
      .then(setPu)
      .catch((err) => setLoadError(err.message));
  }, [token, id]);

  useEffect(() => { load(); }, [load]);

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const blob = await api.exportPdf(token, id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setExportingPdf(false);
    }
  };

  if (loadError) {
    return (
      <Layout>
        <div className="stat-card" style={{ borderColor: 'var(--error-red)', borderWidth: 2, maxWidth: 560 }}>
          <div className="label" style={{ color: 'var(--error-red)' }}>Couldn&apos;t load this polling unit</div>
          <p style={{ fontSize: 14, color: 'var(--ink-soft)', marginTop: 8 }}>{loadError}</p>
          <Button className="btn btn-primary" style={{ marginTop: 12 }} onPress={load}>
            Retry
          </Button>
        </div>
      </Layout>
    );
  }

  if (!pu) return <Layout><p>Loading…</p></Layout>;

  const hasSubmission = !!pu.status;

  return (
    <Layout>
      <div className="admin-sticky-header">
        <Breadcrumbs
          crumbs={[
            { label: 'Federal Constituency', to: '/dashboard' },
            { label: pu.lga_name, to: '#' },
            { label: pu.ward_name, to: '#' },
            { label: `${pu.pu_name} — PU ${pu.pu_number}`, to: `/polling-unit/${id}` },
          ]}
        />
        <div className="page-heading">
          <div className="page-kicker">Polling Unit Detail</div>
          <div className="flex items-center justify-between gap-4">
            <h1 style={{ margin: 0 }}>{pu.pu_name} — PU {pu.pu_number}</h1>
            {hasSubmission && (
              <Button className="btn btn-secondary" isDisabled={exportingPdf} onPress={handleExportPdf}>
                {exportingPdf ? 'Exporting…' : 'Export PDF'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {!hasSubmission ? (
        <>
          <p style={{ color: 'var(--ink-soft)', marginBottom: 24 }}>
            No accepted result has been submitted for this polling unit yet.
          </p>
          <InviteCodesPanel pollingUnitId={id} />
        </>
      ) : (
        <>
          <div className="card-grid">
            <StatCard label="Reference" value={pu.reference_number} mono small />
            <StatCard label="Registered voters" value={pu.total_registered_voters} />
            <StatCard label="Accredited voters" value={pu.total_accredited_voters} />
            <StatCard label="Valid votes" value={pu.total_valid_votes} />
            <StatCard label="Invalid votes" value={pu.total_invalid_votes} />
            <StatCard label="Total votes" value={pu.total_votes} />
          </div>

          <div style={{ marginBottom: 24, fontSize: 14, color: 'var(--ink-soft)' }}>
            <div>Submitted by: {pu.submitting_agent_name} ({pu.submitting_agent_phone})</div>
            <div>Captured: {new Date(pu.captured_at).toLocaleString()}</div>
            <div>
              Status: <span className={`status-pill ${pu.status}`}>{pu.status.replace('_', ' ')}</span>
              {pu.gps_flagged && <span className="status-pill flagged" style={{ marginLeft: 6 }}>GPS outside expected radius</span>}
            </div>
          </div>

          <h3 style={{ fontSize: 14 }}>Photos</h3>
          <div className="detail-photo-grid" style={{ marginBottom: 32 }}>
            {['agent_tag', 'result_sheet', 'agent_passport'].map((type) => {
              const photo = pu.photos.find((p) => p.photo_type === type);
              return <PhotoTile key={type} label={PHOTO_LABELS[type]} token={token} photo={photo} onOpen={setLightbox} />;
            })}
          </div>

          <PartyResultsPanel parties={pu.partyVotes} title="Party votes at this polling unit" />

          {message && (
            <p className={message.type === 'ok' ? 'error-text' : 'error-text'} style={{ color: message.type === 'ok' ? 'var(--field-green-dark)' : 'var(--error-red)' }}>
              {message.text}
            </p>
          )}
        </>
      )}

      <Modal.Root state={{ isOpen: !!lightbox, setOpen: (open) => { if (!open) setLightbox(null); } }}>
        <Modal.Backdrop className="lightbox-backdrop">
          <Modal.Container className="lightbox-container">
            <Modal.Dialog className="lightbox-dialog">
              <Modal.CloseTrigger className="lightbox-close" aria-label="Close photo" />
              <Modal.Body className="lightbox-body">
                {lightbox && (
                  <>
                    <img className="lightbox-img" src={lightbox.url} alt={lightbox.label} />
                    <div className="lightbox-meta">{lightbox.label} — click outside or press ESC to close</div>
                  </>
                )}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>
    </Layout>
  );
}

function StatCard({ label, value, mono, small }) {
  return (
    <Card className="stat-card">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: small ? 15 : 24, fontFamily: mono ? 'var(--font-mono)' : undefined }}>
        {value}
      </div>
    </Card>
  );
}
