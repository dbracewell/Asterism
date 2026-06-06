import Constellation from "@/components/logo";
import Link from "next/link";

export const Header = () => {
  return (
    <div className="bg-sidebar sticky flex h-10 items-center justify-between overflow-clip border-b py-1 shadow-sm select-none">
      <Link href="/app" className="group flex items-center font-monsterrat">
        <Constellation className="opacity-50"/>
        <h1 className="text-lg font-semibold ">
          ASTERISM
        </h1>
      </Link>
    </div>
  );
};
