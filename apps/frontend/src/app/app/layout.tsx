import { DashboardLayout } from "@/features/dashboard/components/dashboard-layout";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
