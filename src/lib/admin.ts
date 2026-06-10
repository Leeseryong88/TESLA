import type { User } from "firebase/auth";

const configuredAdminUids = (import.meta.env.VITE_ADMIN_UIDS ?? "")
  .split(",")
  .map((uid) => uid.trim())
  .filter(Boolean);

export async function isAdminUser(user: User) {
  const token = await user.getIdTokenResult(true);
  return token.claims.admin === true || configuredAdminUids.includes(user.uid);
}
