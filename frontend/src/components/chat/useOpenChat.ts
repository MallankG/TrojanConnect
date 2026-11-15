"use client";

import { useEffect, useState } from "react";
import { useDb, useUser } from "@/lib/api/client";

/**
 * Find or create a conversation once the demo data and user are loaded.
 * Opening may write to the store, so it runs in an effect, never during render.
 */
export function useOpenChat(open: () => string, deps: unknown[]): string | null {
  const ready = useDb().seededAt !== "";
  const user = useUser();
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !user) return;
    const next = open();
    const frame = requestAnimationFrame(() => setId(next));
    return () => cancelAnimationFrame(frame);
    // `open` is recreated every render; `deps` says when it really changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id, ...deps]);

  return id;
}
