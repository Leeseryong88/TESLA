import type { User } from "firebase/auth";

const configuredAdminUids = (import.meta.env.VITE_ADMIN_UIDS ?? "")
  .split(",")
  .map((uid) => uid.trim())
  .filter(Boolean);

export function isAdminUser(user: User) {
  return configuredAdminUids.includes(user.uid);
}
