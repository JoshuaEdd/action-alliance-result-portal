import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Modal } from '@heroui/react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import Layout from '../components/Layout';
import Breadcrumbs from '../components/Breadcrumbs';

const fmt = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const STATUS_PILL = { pending: 'correction_pending', approved: 'submitted', rejected: 'flagged' };

function PhotoTile({ label, token, photo, getUrl, onOpen }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let revoke;
    if (!photo) return;
    getUrl(token, photo.id)
      .then((u) => { setUrl(u); revoke = u; })
      .catch((e) => setError(e.message));
    return () => revoke && URL.revokeObjectURL(revoke);
  }, [token, photo, getUrl]);

  return (
    <div className="ph-wrap">
      <button type="button" className="ph" onClick={() => onOpen && onOpen({ label, url })} disabled={!url || !!error} title="Click to view full size">
        {photo ? (error ? `${label}\nerror loading photo` : <img src={url} alt={label} />) : `${label}\nnot attached`}
      </button>
      <div className="ph-caption">
        <span className="ph-caption-label">{label}</span>
        {photo?.captured_at && <span className="ph-caption-time">{fmt(photo.captured_at)}</span>}
      </div>
    </div>
  );
}

// Side-by-side ledger: headline counts plus per-party votes, with changed
// figures struck through on the original side and bolded on the proposed side.
function Comparison({ detail, partyName }) {
  const rows = [
    ['Registered voters', detail.original_registered, detail.proposed_registered],
    ['Accredited voters', detail.original_accredited, detail.proposed_accredited],
    ['Invalid votes', detail.original_invalid, detail.proposed_invalid],
    ...mergePartyRows(detail.original_party_votes, detail.proposed_party_votes, partyName),
  ];
  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="tally-row" style={{ fontWeight: 700, borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
        <span className="tally-label">Figure</span>
        <span style={{ textAlign: 'right' }}>Original</span>
        <span style={{ textAlign: 'right' }}>Proposed</span>
      </div>
      {rows.map(([label, o, p]) => {
        const changed = Number(o) !== Number(p);
        return (
          <div key={label} className="tally-row">
            <span className="tally-label">{label}</span>
            <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: changed ? 'var(--error-red)' : undefined, textDecoration: changed ? 'line-through' : undefined }}>{o}</span>
            <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: changed ? 700 : 400 }}>{p}</span>
          </div>
        );
      })}
    </div>
  );
}

function mergePartyRows(originalSnapshot, proposedSnapshot, partyName) {
  const keys = new Set([...Object.keys(originalSnapshot || {}), ...Object.keys(proposedSnapshot || {})]);
  return [...keys].map((id) => [partyName(id), originalSnapshot[id] ?? 0, proposedSnapshot[id] ?? 0]);
}

export default function CorrectionDetailPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();

  const [detail, setDetail] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [decisionError, setDecisionError] = useState(null);
  const [decided, setDecided] = useState(null);

  const load = useCallback(() => {
    setLoadError(null);
    api
      .getCorrectionDetail(token, id)
      .then(setDetail)
      .catch((err) => setLoadError(err.message));
  }, [token, id]);

  useEffect(() => { load(); }, [load]);

  const partyName = useMemo(() => {
    const map = {};
    for (const p of detail?.originalPartyVotes || []) map[p.party_id] = `${p.abbreviation} (${p.name})`;
    return (partyId) => map[partyId] || partyId.slice(0, 8);
  }, [detail]);

  const decide = async (approved) => {
    setDecisionError(null);
    if (!approved && rejectionReason.trim().length < 5) {
      setDecisionError('A rejection reason (at least 5 characters) is required so the agent understands the decision.');
      return;
    }
    const setBusy = approved ? setApproving : setRejecting;
    setBusy(true);
    try {
      await api.decideCorrection(token, id, approved, rejectionReason.trim());
      setDecided({ approved });
      setRejectionReason('');
      await load();
    } catch (err) {
      setDecisionError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <Layout>
        <div className="stat-card" style={{ borderColor: 'var(--error-red)', borderWidth: 2, maxWidth: 560 }}>
          <div className="label" style={{ color: 'var(--error-red)' }}>Couldn&apos;t load this correction request</div>
          <p style={{ fontSize: 14, color: 'var(--ink-soft)', marginTop: 8 }}>{loadError}</p>
          <Button className="btn btn-primary" style={{ marginTop: 12 }} onPress={load}>Retry</Button>
        </div>
      </Layout>
    );
  }

  if (!detail) return <Layout><p>Loading…</p></Layout>;

  const pending = detail.status === 'pending';

  return (
    <Layout>
      <div className="admin-sticky-header">
        <Breadcrumbs
          crumbs={[
            { label: 'Correction Requests', to: '/corrections' },
            { label: detail.reference_number, to: `/corrections/${detail.id}` },
          ]}
        />
        <div className="page-heading">
          <div className="page-kicker">Correction Review</div>
          <div className="flex items-center justify-between gap-4" style={{ flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ margin: 0 }}>{detail.pu_name} — PU {detail.pu_number}</h1>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 4 }}>
                <span className="reference-number" style={{ fontSize: 13 }}>{detail.reference_number}</span>
              </div>
            </div>
            <span className={`status-pill ${STATUS_PILL[detail.status] || ''}`}>{detail.status}</span>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 24, fontSize: 14, color: 'var(--ink-soft)' }}>
        <div>{detail.ward_name} › {detail.lga_name} · Agent: {detail.agent_name} ({detail.agent_phone || 'no phone'})</div>
        <div>Original submitted: {fmt(detail.submitted_at)}</div>
        {detail.capture_place && <div>Capture place: {detail.capture_place}</div>}
        {detail.gps_flagged && <span className="status-pill flagged">GPS outside expected radius</span>}
        <div>Requested: {fmt(detail.created_at)}
          {detail.request_place ? ` · from ${detail.request_place}` : ''}
          {detail.request_lat != null ? ` · (${Number(detail.request_lat).toFixed(5)}, ${Number(detail.request_lng).toFixed(5)})` : ''}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="tally-row" style={{ fontWeight: 700 }}>Correction Reason</div>
        <p style={{ margin: '6px 0 0', fontSize: 14, whiteSpace: 'pre-wrap' }}>{detail.reason}</p>
      </div>

      <h3 style={{ fontSize: 14 }}>Original vs Proposed</h3>
      <Comparison detail={detail} partyName={partyName} />

      <h3 style={{ fontSize: 14 }}>Original submission photos</h3>
      <div className="detail-photo-grid is-administrative" style={{ marginBottom: 24 }}>
        {detail.originalPhotos?.length
          ? detail.originalPhotos.map((p) => (
            <PhotoTile key={p.id} label={p.photo_type.replace(/_/g, ' ')} token={token} photo={p} getUrl={api.getPhotoUrl} onOpen={setLightbox} />
          ))
          : 'No photos recorded for the original submission.'}
      </div>

      <h3 style={{ fontSize: 14 }}>Evidence attached to this request</h3>
      <div className="detail-photo-grid is-administrative" style={{ marginBottom: 24 }}>
        {detail.evidencePhotos?.length
          ? detail.evidencePhotos.map((p) => (
            <PhotoTile key={p.id} label="Correction evidence" token={token} photo={p} getUrl={api.getCorrectionPhotoUrl} onOpen={setLightbox} />
          ))
          : 'No additional evidence attached.'}
      </div>

      {pending && (
        <div className="card" style={{ marginBlock: 24 }}>
          <div className="tally-row" style={{ fontWeight: 700 }}>Decision</div>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '4px 0 16px' }}>
            Approving applies the corrected figures as the new official result (your superseding record) and archives
            the original. Rejecting leaves the submitted result exactly as it is.
          </p>
          <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Rejection reason (required to reject)</label>
          <textarea
            rows={3}
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="Why is this correction not being applied?"
            aria-label="Rejection reason"
            style={{ width: '100%', border: '1.5px solid var(--line)', borderRadius: 12, padding: 12, fontFamily: 'inherit', marginBottom: 12 }}
          />
          {decisionError && <p className="error-text">{decisionError}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button className="btn btn-primary" onPress={() => decide(true)} isDisabled={approving || rejecting}>
              {approving ? 'Approving…' : 'Approve correction'}
            </Button>
            <Button className="btn btn-danger" onPress={() => decide(false)} isDisabled={approving || rejecting}>
              {rejecting ? 'Rejecting…' : 'Reject correction'}
            </Button>
            <Button className="btn btn-secondary" onPress={() => navigate('/corrections')}>Back to queue</Button>
          </div>
        </div>
      )}

      {!pending && (
        <div className="card" style={{ marginBlock: 24 }}>
          <div className="tally-row" style={{ fontWeight: 700 }}>
            <span>Decision</span>
            <span className={`status-pill ${STATUS_PILL[detail.status] || ''}`}>{detail.status}</span>
          </div>
          {detail.status === 'approved' ? (
            <p style={{ fontSize: 14, margin: '6px 0 0' }}>
              Approved by {detail.decided_by_name || 'an administrator'} on {fmt(detail.decided_at)}.
              {detail.applied_result_id && (
                <> The approved result is the current official record for this polling unit.</>
              )}
            </p>
          ) : (
            <p style={{ fontSize: 14, margin: '6px 0 0' }}>
              Rejected by {detail.decided_by_name || 'an administrator'} on {fmt(detail.decided_at)}.
              The original result remains official.
              {detail.rejection_reason && (
                <> Reason given: “{detail.rejection_reason}”</>
              )}
            </p>
          )}
          <Button className="btn btn-secondary" style={{ marginTop: 12 }} onPress={() => navigate('/corrections')}>Back to queue</Button>
        </div>
      )}

      {decided && (
        <div className="notice" style={{ marginBottom: 24 }}>
          {decided.approved
            ? 'Correction approved — the corrected result is now official and the original is archived. This decision is in the audit log.'
            : 'Correction rejected — the submitted result is unchanged. The agent has been notified.'}
        </div>
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