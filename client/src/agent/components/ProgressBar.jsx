import { STEPS } from '../context/SubmissionContext';

const LABELS = {
  location: 'Location',
  votes: 'Vote Counts',
  agent: 'Agent Details',
  photos: 'Photo Capture',
  preview: 'Preview & Submit',
};

export default function ProgressBar({ stepIndex }) {
  return (
    <div className="progress-bar">
      <div className="eyebrow">
        Step {stepIndex + 1} of {STEPS.length} — {LABELS[STEPS[stepIndex]]}
      </div>
      <div className="progress-track">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`progress-segment ${i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''}`}
          />
        ))}
      </div>
    </div>
  );
}
