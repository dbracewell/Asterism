import { DashboardLayout } from "@/features/dashboard/components/dashboard-layout";
import React from "react";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
