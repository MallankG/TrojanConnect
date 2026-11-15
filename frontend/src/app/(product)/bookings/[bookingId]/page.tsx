import { Suspense } from "react";
import type { Metadata } from "next";
import { Only, Page as Column } from "@/components/layout/AppShell";
import { ListSkeleton } from "@/components/ui/kit";
import { BookingDetail } from "@/components/screens/clubLive";

export const metadata: Metadata = { title: "Booking" };

// The id in the URL is only known at request time, so the screen that reads it
// sits inside Suspense (required with cacheComponents).
export default function Page() {
  return (
    <Only roles={["club_rep", "venue_reviewer"]}>
      <Suspense fallback={<Column><ListSkeleton /></Column>}>
        <BookingDetail />
      </Suspense>
    </Only>
  );
}
