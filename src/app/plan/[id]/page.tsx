import { PlanView } from "../../components/PlanView";
import { ResultNav } from "../../components/ResultNav";

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <h1>Your practice plan</h1>
      <ResultNav id={id} current="plan" />
      <PlanView id={id} />
    </>
  );
}
