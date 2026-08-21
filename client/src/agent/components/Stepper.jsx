import { STEPS } from '../context/SubmissionContext';

const LABELS = {
  location: 'Location',
  votes: 'Votes',
  agent: 'Agent',
  photos: 'Photos',
  preview: 'Submit',
};

// Animated step indicator: numbered dots joined by a fill line that grows
// with progress; completed steps pop a checkmark. Pure CSS transitions —
// no animation library needed.
export default function Stepper({ stepIndex }) {
  return (
    <div className="stepper" role="progressbar" aria-valuenow={stepIndex + 1} aria-valuemin={1} aria-valuemax={STEPS.length}>
      {STEPS.map((step, i) => {
        const state = i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'todo';
        return (
          <div key={step} className={`stepper-node ${state}`}>
            <div className="stepper-dot">
              <span className="stepper-num">{i + 1}</span>
              <span className="stepper-check">✓</span>
            </div>
            <span className="stepper-label">{LABELS[step]}</span>
            {i < STEPS.length - 1 && (
              <div className="stepper-link">
                <div className="stepper-link-fill" style={{ transform: i < stepIndex ? 'scaleX(1)' : 'scaleX(0)' }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
