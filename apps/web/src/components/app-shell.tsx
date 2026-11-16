/**
 * Every screen shares this frame: the 36 px status strip, the 44 px nav rail, the screen canvas
 * and the assistant dock (resizable and collapsible from 768 px; a bottom drawer below that).
 */
import { AiChat02Icon } from "@hugeicons/core-free-icons";
import { type ReactNode, useCallback, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import { Outlet } from "react-router";
import { CommandMenu, CommandMenuProvider } from "@/components/command-menu";
import { EmptyState } from "@/components/empty-state";
import { NavRail } from "@/components/nav-rail";
import { StatusStrip } from "@/components/status-strip";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useMediaQuery } from "@/lib/motion";

/** Stands in until the assistant screen mounts its dock here. */
export function AssistantDockPlaceholder() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center border-b border-line px-3">
        <h2 className="text-xs font-medium text-text-2 font-label">Assistant</h2>
      </div>
      <EmptyState
        icon={AiChat02Icon}
        title="Ask about the fleet"
        description="Where to bunker, which route and speed, what a voyage emits, how long a port's queue is. Every number in an answer opens to the fact behind it."
      />
    </div>
  );
}

export function AppShell({ dock }: { dock?: ReactNode }) {
  const wide = useMediaQuery("(min-width: 768px)", true);
  const dockPanel = usePanelRef();
  const [dockOpen, setDockOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dockContent = dock ?? <AssistantDockPlaceholder />;

  const toggleDock = useCallback(() => {
    if (!wide) {
      setDrawerOpen((o) => !o);
      return;
    }
    const panel = dockPanel.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  }, [wide, dockPanel]);

  return (
    <CommandMenuProvider>
      <div className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr] overflow-hidden bg-ink-950 text-text-1">
        <StatusStrip dockOpen={wide ? dockOpen : drawerOpen} onToggleDock={toggleDock} />
        <div className="flex min-h-0">
          <NavRail />
          {wide ? (
            <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
              <ResizablePanel id="canvas" minSize="40%">
                <main id="screen" className="h-full min-w-0 overflow-auto">
                  <Outlet />
                </main>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel
                id="assistant"
                panelRef={dockPanel}
                defaultSize={360}
                minSize={280}
                maxSize="50%"
                collapsible
                collapsedSize={0}
                onResize={(size) => setDockOpen(size.inPixels > 0)}
              >
                <aside aria-label="Assistant" className="h-full min-w-0 overflow-hidden bg-ink-900">
                  {dockContent}
                </aside>
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <main id="screen" className="h-full min-w-0 flex-1 overflow-auto">
              <Outlet />
            </main>
          )}
        </div>
      </div>
      {wide ? null : (
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerContent className="h-[80vh]">
            <DrawerTitle className="sr-only">Assistant</DrawerTitle>
            <DrawerDescription className="sr-only">Ask about the fleet.</DrawerDescription>
            {dockContent}
          </DrawerContent>
        </Drawer>
      )}
      <CommandMenu />
    </CommandMenuProvider>
  );
}
