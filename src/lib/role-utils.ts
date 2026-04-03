import { Role } from '@/hooks/useAuth';

/**
 * REQUIREMENT 2 & 3: Normalizes a role string to a consistent value.
 * - Treats 'interviewer' and 'panel' as the same role: 'panel'.
 * - Converts the role to lowercase.
 * - Provides a fallback for null or undefined roles.
 */
export const normalizeRole = (role: Role | string | null | undefined): string => {
  if (!role) return "guest"; // Fallback for logged-out or role-less users
  const r = role.toLowerCase().trim();
  if (r === "interviewer") return "panel";
  return r;
};
