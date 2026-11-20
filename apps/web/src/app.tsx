import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { RouterProvider } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/queries";
import { createRouter } from "@/routes";

/**
 * Root of the ops console: server state, tooltips, routes and the one toaster. Toasts sit at the
 * bottom left, clear of the 44 px nav rail, away from the map's plan chip and the assistant's
 * composer, and leave after 4 s.
 */
export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(createRouter);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
        <Toaster
          position="top-center"
          duration={4000}
          offset={{ top: 56 }}
          mobileOffset={{ top: 56 }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
