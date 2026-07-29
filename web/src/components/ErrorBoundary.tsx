import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-base flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <h1 className="font-display text-2xl font-bold text-[#EF4444] mb-4">应用崩溃</h1>
            <p className="text-secondary mb-6 text-sm break-all">
              {this.state.error?.message || '未知错误'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-5 py-2.5 bg-[var(--primary-500)] text-white rounded-lg hover:bg-[var(--primary-600)] hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
