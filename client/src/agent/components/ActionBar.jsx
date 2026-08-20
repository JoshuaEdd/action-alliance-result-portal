export default function ActionBar({ onBack, onNext, nextLabel = 'Continue', nextDisabled, showBack = true }) {
  return (
    <div className="action-bar">
      {showBack && (
        <button className="btn btn-secondary" onClick={onBack} type="button">
          Back
        </button>
      )}
      <button className="btn btn-primary" onClick={onNext} disabled={nextDisabled} type="button">
        {nextLabel}
      </button>
    </div>
  );
}
