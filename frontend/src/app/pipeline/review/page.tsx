import type { Metadata } from "next";
import { Page } from "@/components/layout/AppShell";
import { VenueReviewApp } from "@/components/review/VenueReviewApp";

export const metadata: Metadata = {
  title: "Venue Review · TrojanConnect",
  description: "Approve, reject or request changes on venue bookings and event permits prepared by the Club and Venue agents.",
};

export default function VenueReviewPage() {
  return <Page wide><VenueReviewApp /></Page>;
}
