import type { Metadata } from "next";
import { Only } from "@/components/layout/AppShell";
import { BookingsList } from "@/components/screens/club";

export const metadata: Metadata = { title: "Bookings" };

export default function Page() {
  return (
    <Only roles={["club_rep"]}>
      <BookingsList />
    </Only>
  );
}
