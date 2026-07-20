import Constellation from "@/components/logo";
import Link from "next/link";

export const FullLogo = ({ fill }: { fill?: string }) => {
  return (
    <Link
      href="/"
      className="group/header font-monsterrat flex items-center gap-2 text-shadow-2xs"
    >
      <Constellation
        className="opacity-50 group-hover/header:opacity-100"
        size={100}
        fill={fill}
      />
      <h1 className="text-lg font-semibold opacity-50 group-hover/header:opacity-100">
        ASTERISM
      </h1>
    </Link>
  );
};
