import { ClassesPage } from "@/features/classes/components/classes-page";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ join?: string }>;
}) {
  const { join } = await searchParams;
  return <ClassesPage initialCode={join ?? ""} />;
}
