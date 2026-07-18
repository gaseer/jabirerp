import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // CRITICAL for offline-first: every queryFn reads Dexie, never the
            // network. The default networkMode ("online") PAUSES queries while
            // offline, which made all local data vanish the moment the network
            // dropped. "always" runs them regardless of connectivity.
            networkMode: "always",
            // Dexie reads are ~ms; refetch on every mount so totals and lists
            // are never stale after cross-page writes.
            retry: 1,
            refetchOnWindowFocus: false,
          },
          mutations: {
            // Mutations also write Dexie-first — never pause them offline.
            networkMode: "always",
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
