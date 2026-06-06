import Image from "next/image";
import Link from "next/link";

export const Header = () => {
  return (
    <div className="bg-sidebar sticky flex h-10 items-center justify-between overflow-clip border-b py-1 shadow-sm select-none">
      <Link href="/app" className="group flex items-center gap-2">
        <Image
          src="/logo.png"
          alt="asterism"
          height={128}
          width={128}
          className="opacity-40 transition-opacity group-hover:opacity-100"
        />
        <h1 className="text-lg font-bold">
          <span className="text-blue-600 text-shadow-2xs">Chat</span>
          <span className="text-green-600 text-shadow-2xs">Gator</span>
        </h1>
      </Link>
    </div>
  );
};
