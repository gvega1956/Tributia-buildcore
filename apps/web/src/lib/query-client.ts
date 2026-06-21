import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,     // 1 minuto antes de refetch en background
      gcTime: 1000 * 60 * 10,   // 10 minutos en caché tras desmontarse
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
