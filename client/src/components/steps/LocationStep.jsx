import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSubmission } from '../../context/SubmissionContext';
import { api } from '../../api/client';
import ActionBar from '../ActionBar';

export default function LocationStep() {
  const { token, user } = useAuth();
  const { draft, updateDraft, goNext } = useSubmission();
  const [lgas, setLgas] = useState([]);
  const [wards, setWards] = useState([]);
  const [pollingUnits, setPollingUnits] = useState([]);

  // FR-2.2 — once an agent's location has been confirmed, it's locked for
  // every future session. Changing it requires an administrator.
  const locked = user?.locationLocked;

  useEffect(() => {
    api.getLGAs(token).then(setLgas).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (draft.localGovernmentId) {
      api.getWards(token, draft.localGovernmentId).then(setWards).catch(() => {});
    } else {
      setWards([]);
    }
  }, [token, draft.localGovernmentId]);

  useEffect(() => {
    if (draft.wardId) {
      api.getPollingUnits(token, draft.wardId).then(setPollingUnits).catch(() => {});
    } else {
      setPollingUnits([]);
    }
  }, [token, draft.wardId]);

  const canContinue = draft.localGovernmentId && draft.wardId && draft.pollingUnitId;

  return (
    <>
      <div className="step-content">
        <h2>Where are you reporting from?</h2>
        <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>
          {locked
            ? 'Your polling unit is locked to your account. Contact an administrator if this needs to change.'
            : 'This is confirmed once and then locked to your account for every future session.'}
        </p>

        <div className="field">
          <label htmlFor="lga">Local Government</label>
          <select
            id="lga"
            disabled={locked}
            value={draft.localGovernmentId}
            onChange={(e) => updateDraft({ localGovernmentId: e.target.value, wardId: '', pollingUnitId: '' })}
          >
            <option value="">Select local government</option>
            {lgas.map((lga) => (
              <option key={lga.id} value={lga.id}>{lga.name}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="ward">Ward</label>
          <select
            id="ward"
            disabled={locked || !draft.localGovernmentId}
            value={draft.wardId}
            onChange={(e) => updateDraft({ wardId: e.target.value, pollingUnitId: '' })}
          >
            <option value="">Select ward</option>
            {wards.map((w) => (
              <option key={w.id} value={w.id}>{w.name} — Ward {w.ward_number}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="pu">Polling Unit</label>
          <select
            id="pu"
            disabled={locked || !draft.wardId}
            value={draft.pollingUnitId}
            onChange={(e) => updateDraft({ pollingUnitId: e.target.value })}
          >
            <option value="">Select polling unit</option>
            {pollingUnits.map((pu) => (
              <option key={pu.id} value={pu.id}>{pu.name} — PU {pu.pu_number}</option>
            ))}
          </select>
        </div>
      </div>
      <ActionBar showBack={false} onNext={goNext} nextDisabled={!canContinue} />
    </>
  );
}
