import { useQuery } from "@tanstack/react-query";
import { fetchImageCache } from "@/lib/api";

export function useImageCache() {
  return useQuery({
    queryKey: ["image-cache"],
    queryFn: fetchImageCache,
  });
}
