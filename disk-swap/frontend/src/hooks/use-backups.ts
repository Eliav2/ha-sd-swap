import { useQuery } from "@tanstack/react-query";
import { fetchBackups } from "@/lib/api";

export function useBackups() {
  return useQuery({
    queryKey: ["backups"],
    queryFn: fetchBackups,
    select: (data) => data.backups,
  });
}
