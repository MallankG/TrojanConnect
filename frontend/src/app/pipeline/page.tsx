import type { Metadata } from "next";
import { PipelineApp } from "@/components/pipeline/PipelineApp";

export const metadata: Metadata = {
  title: "Event Pipeline · TrojanConnect",
  description: "Track every step of planning a club event, from venue to publicity, with forms pre-filled from one event profile.",
};

export default function PipelinePage() {
  return <PipelineApp />;
}
