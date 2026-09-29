import type { DiscoveryJob } from "@mediago/core-sdk";
import { useMemoizedFn } from "ahooks";
import { useRef, useState } from "react";
import { getDownloadTasks } from "@/api/download-task";
import {
  cancelSourceDiscovery,
  createSourceDiscovery,
  createSourceDiscoveryDownloads,
  getSourceDiscovery,
} from "@/api/source-discovery";

const DISCOVERY_TIMEOUT_MS = 20_000;
const POLL_MS = 400;
// Discovery carries its own budget; this client-side deadline only guards a
// bridge that never reports a terminal state.
const POLL_GRACE_MS = 15_000;

export interface ScrapeOutcome {
  created: number;
  failed: number;
  skipped: number;
  sites: number;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      window.clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function pollToTerminal(
  job: DiscoveryJob,
  signal: AbortSignal,
): Promise<DiscoveryJob> {
  const deadline = Date.now() + DISCOVERY_TIMEOUT_MS + POLL_GRACE_MS;
  let current = job;
  while (
    (current.status === "pending" || current.status === "running") &&
    Date.now() < deadline
  ) {
    await delay(POLL_MS, signal);
    current = await getSourceDiscovery(current.id, signal);
  }
  if (current.status === "pending" || current.status === "running") {
    await cancelSourceDiscovery(current.id).catch(() => undefined);
  }
  return current;
}

export function useFavoriteScrape() {
  const [isScraping, setIsScraping] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useMemoizedFn(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  });

  const scrapeSites = useMemoizedFn(
    async (urls: string[]): Promise<ScrapeOutcome> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const signal = controller.signal;
      setIsScraping(true);

      const outcome: ScrapeOutcome = {
        created: 0,
        failed: 0,
        skipped: 0,
        sites: urls.length,
      };
      try {
        const existingUrls = new Set<string>();
        try {
          const { list } = await getDownloadTasks({
            current: 1,
            pageSize: 1_000,
          });
          for (const task of list) existingUrls.add(task.url);
        } catch {
          // Best-effort preflight; the Core still rejects a duplicate URL.
        }

        for (const url of urls) {
          if (signal.aborted) break;
          try {
            const started = await createSourceDiscovery(
              {
                url,
                mode: "browser",
                timeoutMs: DISCOVERY_TIMEOUT_MS,
                useSessionCookies: true,
              },
              signal,
            );
            const job = await pollToTerminal(started, signal);
            const fresh = job.sources.filter(
              (source) => source.url && !existingUrls.has(source.url),
            );
            if (job.status === "cancelled" || fresh.length === 0) {
              outcome.skipped += 1;
              continue;
            }
            const names: Record<string, string> = {};
            for (const source of fresh) names[source.id] = source.title;
            const videos = await createSourceDiscoveryDownloads(job.id, {
              sourceIds: fresh.map((source) => source.id),
              names,
              startDownload: true,
            });
            outcome.created += videos?.length ?? 0;
            for (const source of fresh) existingUrls.add(source.url);
          } catch {
            if (signal.aborted) break;
            outcome.failed += 1;
          }
        }
        return outcome;
      } finally {
        setIsScraping(false);
        controllerRef.current = null;
      }
    },
  );

  return { cancel, isScraping, scrapeSites };
}
