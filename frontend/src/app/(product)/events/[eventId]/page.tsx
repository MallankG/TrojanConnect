import { Suspense } from "react";
import type { Metadata } from "next";
import { Page as Column } from "@/components/layout/AppShell";
import { ListSkeleton } from "@/components/ui/kit";
import { EventPage } from "@/components/screens/extras";

export const metadata: Metadata = { title: "Event" };

// The id in the URL is only known at request time, so the screen that reads it
// sits inside Suspense (required with cacheComponents).
export default function Page() {
  return (
    <Suspense fallback={<Column><ListSkeleton /></Column>}>
      <EventPage />
    </Suspense>
  );
}
