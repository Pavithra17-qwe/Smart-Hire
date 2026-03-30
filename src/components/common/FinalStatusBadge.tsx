import { Badge } from "@/components/ui/badge";
import { Candidate } from "@/types/candidate";

export const getFinalStatusBadge = (candidate: Candidate) => {
    const status = candidate.finalStatus || 'In Progress';
    const normalized = status?.trim().toLowerCase();

    let color = "!bg-gray-100 !text-gray-700";

    if (normalized === "rejected") {
        color = "!bg-red-100 !text-red-700";
    } else if (["accepted", "selected", "completed"].includes(normalized || "")) {
        color = "!bg-green-100 !text-green-700";
    } else if (normalized === "scheduled") {
        color = "!bg-blue-100 !text-blue-700";
    } else if (normalized === "released") {
        color = "!bg-orange-100 !text-orange-700";
    } else if (normalized === "in progress") {
        color = "!bg-purple-100 !text-purple-700";
    }

    return <Badge className={`capitalize ${color}`}>{status}</Badge>;
};
