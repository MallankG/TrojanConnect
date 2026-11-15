import type { Metadata } from "next";
import { Only, Page } from "@/components/layout/AppShell";
import { PipelineApp } from "@/components/pipeline/PipelineApp";

export const metadata: Metadata = { title: "Plan an event" };

export default function PlanPage() {
  return (
    <Only roles={["club_rep"]}>
      <Page wide>
        <PipelineApp />
      </Page>
    </Only>
  );
}
