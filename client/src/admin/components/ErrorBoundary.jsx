import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="admin-shell">
        <main className="main">
          <div className="card-grid" style={{ maxWidth: 640, marginTop: 48 }}>
            <div className="stat-card" style={{ borderColor: 'var(--error-red)', borderWidth: 2 }}>
              <div className="label" style={{ color: 'var(--error-red)' }}>Something went wrong</div>
              <div className="value" style={{ fontSize: 14, marginTop: 8 }}>
                An unexpected error occurred while rendering this page.
              </div>
              <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 12 }}>
                {String(this.state.error?.message || this.state.error)}
              </p>
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: 16 }}
                onClick={() => window.location.reload()}
              >
                Reload page
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }
}