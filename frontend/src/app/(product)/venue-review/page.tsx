import type { Metadata } from "next";
import { Only, Page } from "@/components/layout/AppShell";
import { VenueReviewApp } from "@/components/review/VenueReviewApp";

export const metadata: Metadata = { title: "Review queue" };

export default function ReviewPage() {
  return (
    <Only roles={["venue_reviewer"]}>
      <Page wide>
        <VenueReviewApp />
      </Page>
    </Only>
  );
}
