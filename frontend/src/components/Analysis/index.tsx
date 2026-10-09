'use client';
import React from "react";
import PassRates from "./PassRates";
import Pipeline from "./Pipeline";
import StatTiles from "./StatTiles";
import WeakSpots from "./WeakSpots";
import { ErrorMessage, Loading } from "../ui/Feedback";
import PageHeader from "../ui/PageHeader";
import { useApi } from "@/hooks/useApi";
import { insightsService } from "@/services/InsightsService";

const Analysis = () => {
  const { data, error, loading } = useApi("insights", () => insightsService.get());

  if (error) return <ErrorMessage message={error} />;
  if (loading || !data) return <Loading />;

  return (
    <div className="flex flex-col gap-12xl">
      <PageHeader
        title="Analysis"
        subtitle="Patterns across all your interviews: where you lose points, and where you drop out."
      />
      <StatTiles insights={data} />
      <WeakSpots weakSpots={data.weak_spots} />
      <PassRates outcomes={data.round_outcomes} />
      <Pipeline funnel={data.funnel} />
    </div>
  );
};

export default Analysis;
