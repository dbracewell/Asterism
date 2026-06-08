import Constellation from "@/components/logo";
import Link from "next/link";

export const FullLogo = () => {
  return (
    <Link
      href="/app"
      className="group/header font-monsterrat flex items-center gap-2 text-shadow-2xs"
    >
      <Constellation
        className="opacity-50 group-hover/header:opacity-100"
        size={100}
      />
      <h1 className="text-lg font-semibold opacity-50 group-hover/header:opacity-100">
        ASTERISM
      </h1>
    </Link>
  );
};
