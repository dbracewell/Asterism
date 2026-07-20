import { LoaderCircleIcon } from "lucide-react";

export const Spinner = ({
  size = 80,
  loadingMessage = false,
}: {
  size?: number;
  loadingMessage?: boolean;
}) => {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center">
      <LoaderCircleIcon
        className="text-dodger-blue-500 animate-spin"
        style={{
          width: `${size}px`,
          height: `${size}px`,
        }}
      />
      {loadingMessage && (
        <span className="animate-pulse text-lg font-bold">Loading...</span>
      )}
    </div>
  );
};
