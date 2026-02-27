'use client';

import { Component, type ReactNode } from 'react';
import * as Sentry from '@sentry/nextjs';
import styles from './SectionErrorBoundary.module.css';

interface SectionErrorBoundaryProps {
  sectionName: string;
  fallback?: ReactNode;
  children: ReactNode;
}

interface SectionErrorBoundaryState {
  hasError: boolean;
}

export class SectionErrorBoundary extends Component<SectionErrorBoundaryProps, SectionErrorBoundaryState> {
  constructor(props: SectionErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): SectionErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    Sentry.captureException(error, {
      tags: { section: this.props.sectionName },
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className={styles.fallback}>
          <p className={styles.message}>
            Couldn&apos;t load {this.props.sectionName}.
          </p>
          <button
            className={styles.retryBtn}
            onClick={() => this.setState({ hasError: false })}
            type="button"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
