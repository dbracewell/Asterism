"use client";

import { Component, type ReactNode } from "react";

export const AdminPaneLoading = () => (
  <p role="status" aria-live="polite" className="text-muted-foreground p-4">
    Loading settings pane…
  </p>
);

type AdminPaneErrorBoundaryProps = {
  children: ReactNode;
  paneLabel: string;
};

type AdminPaneErrorBoundaryState = {
  hasError: boolean;
};

export class AdminPaneErrorBoundary extends Component<
  AdminPaneErrorBoundaryProps,
  AdminPaneErrorBoundaryState
> {
  state: AdminPaneErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AdminPaneErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <p role="alert" className="text-destructive p-4">
          {this.props.paneLabel} settings could not be loaded. Reload the page
          to try again.
        </p>
      );
    }

    return this.props.children;
  }
}
