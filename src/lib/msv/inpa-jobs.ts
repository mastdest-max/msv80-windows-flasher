import { previewPathPrefix } from "@/lib/preview-path-prefix";

let cached: Promise<Record<string, string[]>> | null = null;

/** Job names from the INPA scripts. Loaded as data so the publish build stays small. */
export function loadInpaJobs(): Promise<Record<string, string[]>> {
  if (!cached) {
    const prefix = typeof window === "undefined" ? "" : (previewPathPrefix(window.location.hostname, window.location.pathname) ?? "");
    cached = fetch(`${prefix}/inpa-jobs.json`).then((response) => {
      if (!response.ok) throw new Error("The module job list did not load.");
      return response.json() as Promise<Record<string, string[]>>;
    });
  }
  return cached;
}
