import { useMemo } from 'react';
import { useSubmission } from '../../context/SubmissionContext';
import ActionBar from '../ActionBar';

const NG_PHONE = /^(\+234|0)[789][01]\d{8}$/;

export default function AgentDetailsStep() {
  const { draft, updateDraft, goNext, goBack } = useSubmission();

  const phoneError = useMemo(() => {
    if (!draft.submittingAgentPhone) return null;
    return NG_PHONE.test(draft.submittingAgentPhone) ? null : 'Enter a valid Nigerian phone number (e.g. 080XXXXXXXX)';
  }, [draft.submittingAgentPhone]);

  const canContinue =
    draft.submittingAgentName.trim().length > 1 &&
    NG_PHONE.test(draft.submittingAgentPhone || '');

  return (
    <>
      <div className="step-content">
        <h2>Agent details</h2>
        <div className="field">
          <label htmlFor="agentName">Polling unit agent's name</label>
          <input
            id="agentName"
            type="text"
            value={draft.submittingAgentName}
            onChange={(e) => updateDraft({ submittingAgentName: e.target.value })}
            placeholder="Full name"
          />
        </div>
        <div className="field">
          <label htmlFor="agentPhone">Agent phone number</label>
          <input
            id="agentPhone"
            type="tel"
            value={draft.submittingAgentPhone}
            onChange={(e) => updateDraft({ submittingAgentPhone: e.target.value })}
            placeholder="080XXXXXXXX"
          />
          {phoneError && <p className="error-text">{phoneError}</p>}
        </div>
      </div>
      <ActionBar onBack={goBack} onNext={goNext} nextDisabled={!canContinue} />
    </>
  );
}
