import { Sidebar } from "@/components/layout/Sidebar";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { TabBarNav } from "@/components/layout/TabBarNav";

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh w-full bg-bg">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[860px] px-4 py-4 md:px-8 md:py-7">
            {children}
          </div>
        </main>
        <TabBarNav className="md:hidden" />
      </div>
    </div>
  );
}
