import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export const ImageGenSettings = () => {
  return (
    <Empty className="rounded-lg border p-8">
      <EmptyHeader>
        <EmptyTitle>Image Generation</EmptyTitle>
        <EmptyDescription>
          Image generation provider and model configurations are planned for a
          future release.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
};
