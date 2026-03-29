import { collection, getDocs, writeBatch, doc, DocumentData } from 'firebase/firestore';
import { db } from './firebase';

const STAGES = [
    { key: 'resumeStatus', label: 'Resume' },
    { key: 'l1Status', label: 'L1', oldKey: 'r1Status' },
    { key: 'l2Status', label: 'L2', oldKey: 'r2Status' },
    { key: 'hrRoundStatus', label: 'HR', oldKey: 'hrStatus' },
    { key: 'offerStatus', label: 'Offer' },
];

const getUnifiedStageStatus = (candidate: DocumentData, stage: typeof STAGES[0]): string | undefined => {
    return candidate[stage.key] ?? (stage.oldKey ? candidate[stage.oldKey] : undefined);
};

/**
 * REQUIREMENT 4: Cleans up stale data in Firebase by enforcing workflow progression.
 */
export const runCandidateDataMigration = async () => {
    const batch = writeBatch(db);
    const candidatesSnapshot = await getDocs(collection(db, 'candidates'));
    let migrationCount = 0;

    candidatesSnapshot.forEach(docSnapshot => {
        const candidate = docSnapshot.data();
        const updates: DocumentData = {};
        let needsUpdate = false;
        let progressionIsLocked = false;
        const isSelected = (status?: string) => ['selected', 'accepted'].includes((status || '').toLowerCase());

        for (const stage of STAGES) {
            const rawStatus = getUnifiedStageStatus(candidate, stage);

            if (progressionIsLocked) {
                // If a previous stage was not completed, lock this one.
                if (rawStatus) { // only update if a stale value exists
                    updates[stage.key] = null; // Using null to remove the field
                    needsUpdate = true;
                }
            } else {
                // Check for and consolidate old keys
                if (stage.oldKey && candidate[stage.oldKey]) {
                    updates[stage.key] = candidate[stage.oldKey];
                    updates[stage.oldKey] = null; // Remove the old key
                    needsUpdate = true;
                }
                if (!isSelected(rawStatus)) {
                    progressionIsLocked = true;
                }
            }
        }

        if (needsUpdate) {
            batch.update(doc(db, 'candidates', docSnapshot.id), updates);
            migrationCount++;
        }
    });

    if (migrationCount > 0) {
        await batch.commit();
        console.log(`Successfully migrated ${migrationCount} candidates.`);
        return `Migrated ${migrationCount} candidates successfully.`;
    } else {
        console.log("No candidates needed migration.");
        return "No candidates needed migration.";
    }
};