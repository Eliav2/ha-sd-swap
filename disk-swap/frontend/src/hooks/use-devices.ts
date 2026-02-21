import { useQuery } from "@tanstack/react-query";
import { fetchDevices } from "@/lib/api";

export function useDevices() {
  return useQuery({
    queryKey: ["devices"],
    queryFn: fetchDevices,
    refetchInterval: 3000,
    select: (data) => data.devices,
  });
}
