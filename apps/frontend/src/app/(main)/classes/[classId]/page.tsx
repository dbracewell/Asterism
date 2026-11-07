import { ClassDetail } from "@/features/classes/components/class-detail";

export default async function Page({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  return <ClassDetail classId={classId} />;
}
