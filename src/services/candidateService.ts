
// import { addDoc, collection, Timestamp, query, where } from "firebase/firestore";
import { addDoc, collection, deleteDoc, doc, Timestamp, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Role } from "@/hooks/useAuth";

export const getCandidatesQuery = (role: Role, uid: string | null) => {
    if (!role) return null;

    const userRole = role.toLowerCase();
    if (['admin', 'panel', 'interviewer', 'hr'].includes(userRole)) {
        return query(collection(db, 'candidates'));
    } else if (userRole === 'agency') {
        return query(collection(db, 'candidates'), where('createdBy', '==', uid));
    } else {
        return null;
    }
};

interface CandidateData {
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string;
  candidateDesignation: string;
  createdBy: string;
  createdByName: string;
  createdByRole: string;
}

export const createNewCandidate = async (data: CandidateData) => {
  console.log("Saving candidate:", data);
  try {
    const newCandidateDoc = {
      ...data,
      createdDate: Timestamp.now(),
      lastUpdated: Timestamp.now(),
      resumeStatus: "Pending",
      l1Status: "Locked",
      l2Status: "Locked",
      hrRoundStatus: "Locked",
      offerStatus: "Locked",
      overallStatus: "Pending",
    };

    await addDoc(collection(db, "candidates"), newCandidateDoc);
    return { success: true };
  } catch (error) {
    console.error("Firestore create failed:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const deleteCandidate = async (id: string) => {
  try {
    await deleteDoc(doc(db, "candidates", id));
    return { success: true };
  } catch (error) {
    console.error("Firestore delete failed:", error);
    return { success: false, error: (error as Error).message };
  }
};
