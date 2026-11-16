import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { RouterProvider } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/queries";
import { createRouter } from "@/routes";

/**
 * Root of the ops console: server state, tooltips, routes and the one toaster. Toasts sit at the
 * top right, under the 36 px status strip, so they never cover the assistant's composer.
 */
export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(createRouter);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
        <Toaster position="top-center" offset={{ top: 44 }} mobileOffset={{ top: 44 }} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
