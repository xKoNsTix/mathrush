import type { Metadata } from "next";
import LeaderboardPage from "./LeaderboardPage";

export const metadata: Metadata = {
  title: "Math Rush — Leaderboard",
  description: "Top scores across all players.",
};

export default function Page() {
  return <LeaderboardPage />;
}
