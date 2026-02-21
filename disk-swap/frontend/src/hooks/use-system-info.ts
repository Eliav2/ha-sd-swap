import { useQuery } from "@tanstack/react-query";
import { fetchSystemInfo } from "@/lib/api";

export function useSystemInfo() {
  return useQuery({
    queryKey: ["system-info"],
    queryFn: fetchSystemInfo,
    staleTime: Infinity,
  });
}
