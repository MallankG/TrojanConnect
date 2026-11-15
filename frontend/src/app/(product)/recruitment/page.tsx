import type { Metadata } from "next";
import { Only } from "@/components/layout/AppShell";
import { Recruitment } from "@/components/screens/clubLive";

export const metadata: Metadata = { title: "Recruitment" };

export default function Page() {
  return (
    <Only roles={["club_rep"]}>
      <Recruitment />
    </Only>
  );
}
