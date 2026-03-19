import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Role } from "@/hooks/use-auth";

type ActivityLogPayload = {
  userId: string;
  userName: string;
  userRole: Role;
  action: string;
  stage: string;
  targetType: 'Candidate' | 'Project';
  targetId: string;
  targetName: string;
  details?: Record<string, any>;
};

export const logActivity = async (payload: ActivityLogPayload) => {
  try {
    if (!payload.userId || !payload.userName || !payload.userRole) {
      console.warn("Activity log skipped due to missing user information.", payload);
      return;
    }
    await addDoc(collection(db, "activity_log"), {
      ...payload,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.error("Failed to log activity:", error);
  }
};
