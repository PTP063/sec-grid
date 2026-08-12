import React from 'react';

export class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null, info: React.ErrorInfo | null}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ info });
    console.error("Root Error Boundary caught:", error, info);
    fetch('http://localhost:5173/__catch_error', {
      method: 'POST',
      body: JSON.stringify({ message: error.message, stack: error.stack })
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: '#f87171', background: '#09090b', height: '100vh', fontFamily: 'monospace', whiteSpace: 'pre-wrap', zIndex: 99999, position: 'relative' }}>
          <h2>💥 Fatal React Error</h2>
          <p>{this.state.error?.message}</p>
          <hr style={{ borderColor: '#3f3f46', margin: '10px 0' }} />
          <pre style={{ fontSize: 11 }}>{this.state.error?.stack}</pre>
          <pre style={{ fontSize: 11, color: '#a1a1aa', marginTop: 10 }}>{this.state.info?.componentStack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
