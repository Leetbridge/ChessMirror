import { DashboardView } from "../../components/DashboardView";
import { ResultNav } from "../../components/ResultNav";

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <h1>Your patterns</h1>
      <ResultNav id={id} current="dashboard" />
      <DashboardView id={id} />
    </>
  );
}
