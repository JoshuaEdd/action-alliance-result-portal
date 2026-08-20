import { useNavigate } from 'react-router-dom';
import { useSubmission } from '../context/SubmissionContext';
import ProgressBar from '../components/ProgressBar';
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
  const { stepIndex, currentStep, submitResult } = useSubmission();
  const navigate = useNavigate();

  if (submitResult) {
    navigate('/confirmation', { replace: true });
    return null;
  }

  const StepComponent = STEP_COMPONENTS[currentStep];

  return (
    <>
      <ProgressBar stepIndex={stepIndex} />
      <StepComponent />
    </>
  );
}
