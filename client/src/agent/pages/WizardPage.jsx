import { useNavigate } from 'react-router-dom';
import { useSubmission } from '../context/SubmissionContext';
import AgentHeader from '../components/AgentHeader';
import Stepper from '../components/Stepper';
import LocationStep from '../components/steps/LocationStep';
import VoteCountsStep from '../components/steps/VoteCountsStep';
import AgentDetailsStep from '../components/steps/AgentDetailsStep';
import PhotoCaptureStep from '../components/steps/PhotoCaptureStep';
import PreviewStep from '../components/steps/PreviewStep';

const STEP_COMPONENTS = {
  location: LocationStep,
  votes: VoteCountsStep,
  agent: AgentDetailsStep,
  photos: PhotoCaptureStep,
  preview: PreviewStep,
};

export default function WizardPage() {
  const { stepIndex, currentStep, gps, submitResult } = useSubmission();
  const navigate = useNavigate();

  if (submitResult) {
    navigate('/confirmation', { replace: true });
    return null;
  }

  const StepComponent = STEP_COMPONENTS[currentStep];

  return (
    <>
      <AgentHeader gps={gps} />
      <Stepper stepIndex={stepIndex} />
      <div key={currentStep} className="step-enter">
        <StepComponent />
      </div>
    </>
  );
}
