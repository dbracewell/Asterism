import { SidebarTrigger } from "@/components/ui/sidebar";

export const NavHeader = () => {
  return (
    <div className="bg-sidebar h-12 border-b flex items-center">
      <SidebarTrigger className="size-11!" />
    </div>
  );
};
