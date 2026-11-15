import type { Metadata } from "next";
import { PipelineApp } from "@/components/pipeline/PipelineApp";

export const metadata: Metadata = {
  title: "Event Pipeline · TrojanConnect",
  description: "Track every step of planning a club event, from venue to publicity, with the venue and permit booked through the Club and Venue agents.",
};

export default function PipelinePage() {
  return <PipelineApp />;
}
