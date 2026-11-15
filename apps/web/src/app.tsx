import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Root of the ops console. Task 9 replaces the body with the shell and routes. */
export function App() {
  return (
    <TooltipProvider>
      <main className="p-3 text-text-2">Pharos console scaffold</main>
      <Toaster />
    </TooltipProvider>
  );
}
