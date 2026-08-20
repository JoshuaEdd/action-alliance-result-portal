import { Label, ProgressBar } from '@heroui/react';
import { STEPS } from '../context/SubmissionContext';

const LABELS = {
  location: 'Location',
  votes: 'Vote Counts',
  agent: 'Agent Details',
  photos: 'Photo Capture',
  preview: 'Preview & Submit',
};

export default function StepProgressBar({ stepIndex }) {
  const current = STEPS[stepIndex];
  const value = Math.round((stepIndex / (STEPS.length - 1)) * 100);

  return (
    <ProgressBar aria-label={`Step ${stepIndex + 1} of ${STEPS.length}`} className="w-full" value={value}>
      <div className="flex items-center justify-between mb-2">
        <Label className="font-medium text-foreground">
          Step {stepIndex + 1} of {STEPS.length} — {LABELS[current]}
        </Label>
        <ProgressBar.Output className="text-xs text-muted tabular-nums">{stepIndex + 1}/{STEPS.length}</ProgressBar.Output>
      </div>
      <ProgressBar.Track className="rounded-full bg-default h-2">
        <ProgressBar.Fill className="rounded-full bg-accent" />
      </ProgressBar.Track>
    </ProgressBar>
  );
}