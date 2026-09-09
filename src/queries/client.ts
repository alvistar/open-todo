import { QueryClient } from "@tanstack/react-query";
import { isUnauthorized } from "../api/errors";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // PollingSource owns freshness (D6); TanStack must not also poll.
      refetchOnWindowFocus: false,
      refetchInterval: false,
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // A rejected credential will not become valid on retry.
        if (isUnauthorized(error)) return false;
        return failureCount < 2;
      },
    },
  },
});
