import Constellation from "@/components/logo";
import Link from "next/link";

export const FullLogo = ({ fill }: { fill?: string }) => {
  return (
    <Link
      href="/"
      className="group/header font-monsterrat flex min-w-0 items-center gap-2 text-shadow-2xs"
    >
      <Constellation
        className="min-w-0 opacity-50 group-hover/header:opacity-100"
        size={100}
        fill={fill}
      />
      <h1 className="font-monsterrat shrink-0 text-lg font-semibold opacity-50 group-hover/header:opacity-100">
        ASTERISM
      </h1>
    </Link>
  );
};
