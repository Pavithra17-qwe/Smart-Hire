import { statusColors } from './statusColors';

export const normalizeStatus = (status: string | undefined | null): { name: string; color: string } => {
  const sanitizedStatus = (status || 'Pending').trim();
  
  const normalizedName = Object.keys(statusColors).find(
    (key) => key.toLowerCase() === sanitizedStatus.toLowerCase()
  );

  const name = normalizedName || 'Pending';
  const color = statusColors[name] || 'bg-gray-100 text-gray-700';

  return { name, color };
};
