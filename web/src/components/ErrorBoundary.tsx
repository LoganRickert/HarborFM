import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className={styles.wrap} role="alert">
          <div className={styles.card}>
            <h1 className={styles.title}>Something Went Wrong</h1>
            <p className={styles.message}>
              An unexpected error occurred. Try reloading the page.
            </p>
            <button
              type="button"
              className={styles.reloadBtn}
              onClick={this.handleReload}
              aria-label="Reload page"
            >
              <RotateCcw size={18} aria-hidden />
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
