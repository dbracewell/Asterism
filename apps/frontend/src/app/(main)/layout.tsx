import { DashboardLayout } from "@/features/dashboard/components/dashboard-layout";
import WorkerProvider from "@/features/sse/components/worker-provider";
import React from "react";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkerProvider>
      <DashboardLayout>{children}</DashboardLayout>
    </WorkerProvider>
  );
}
