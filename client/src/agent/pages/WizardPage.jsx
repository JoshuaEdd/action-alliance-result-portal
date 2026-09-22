import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSubmission } from '../context/SubmissionContext';
import { api } from '../../api/client';
import AgentHeader from '../components/AgentHeader';
import Stepper from '../components/Stepper';
import LocationStep from '../components/steps/LocationStep';
import VoteCountsStep from '../components/steps/VoteCountsStep';
import AgentDetailsStep from '../components/steps/AgentDetailsStep';
import PhotoCaptureStep from '../components/steps/PhotoCaptureStep';
import PreviewStep from '../components/steps/PreviewStep';
import AaLogo from '../../components/AaLogo';

const STEP_COMPONENTS = {
  location: LocationStep,
  votes: VoteCountsStep,
  agent: AgentDetailsStep,
  photos: PhotoCaptureStep,
  preview: PreviewStep,
};

export default function WizardPage() {
  const { stepIndex, currentStep, gps, gpsLoading, submitResult } = useSubmission();
  const navigate = useNavigate();
  // Mirrors the server-side switch (req: global agent-portal deactivation).
  // When off, agents see a clear stop-screen instead of a broken wizard.
  const [portalActive, setPortalActive] = useState(true);

  useEffect(() => {
    api
      .getPortalStatus()
      .then(({ active }) => {
        if (active === false) setPortalActive(false);
      })
      .catch(() => {});
  }, []);

  if (submitResult) {
    navigate('/confirmation', { replace: true });
    return null;
  }

  if (!portalActive) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl bg-[var(--surface)] shadow-lg ring-1 ring-black/5 p-6 flex flex-col items-center gap-4 text-center">
          <AaLogo size={56} />
          <h1 className="text-xl m-0 font-bold" style={{ color: 'var(--aa-green-dark)', fontFamily: 'Poppins, var(--font-display)' }}>
            Agent portal paused
          </h1>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            Agent portal is temporarily unavailable. Please check back when uploads are enabled.
          </p>
        </div>
      </div>
    );
  }

  const StepComponent = STEP_COMPONENTS[currentStep];

  return (
    <>
      <AgentHeader gps={gps} locating={gpsLoading} />
      <Stepper stepIndex={stepIndex} />
      <div key={currentStep} className="step-enter">
        <StepComponent />
      </div>
    </>
  );
}