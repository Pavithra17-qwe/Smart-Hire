import CandidateDetails from "./CandidateDetails";

export async function generateStaticParams() {
  return [
    { id: "1" },
    { id: "2" },
  ];
}

export default function Page() {
  return <CandidateDetails />;
}