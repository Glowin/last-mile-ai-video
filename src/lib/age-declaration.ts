// Self-declaration policy, not identity/document verification. Never persist DOB.
export const AGE_POLICY_VERSION = "18-plus-2026-10-26";
export type AgeDeclaration = {
  birthDate: string;
  confirmed: boolean;
  policyVersion: string;
};
export const emptyAgeDeclaration = (): AgeDeclaration => ({
  birthDate: "", confirmed: false, policyVersion: AGE_POLICY_VERSION,
});
export type AgeError = {
  code: "AGE_REQUIRED" | "AGE_INVALID" | "AGE_INELIGIBLE";
  error: string;
  status: 428 | 400 | 403;
};
export function validateAgeDeclaration(input: unknown, now = new Date()): AgeError | null {
  if (!input || typeof input !== "object")
    return { code: "AGE_REQUIRED", error: "Confirm that you are at least 18 to continue.", status: 428 };
  const value = input as Partial<AgeDeclaration>;
  if (value.confirmed !== true || value.policyVersion !== AGE_POLICY_VERSION || !value.birthDate)
    return { code: "AGE_REQUIRED", error: "Enter your date of birth and confirm the age declaration.", status: 428 };
  const invalid: AgeError = { code: "AGE_INVALID", error: "Enter a valid date of birth (YYYY-MM-DD).", status: 400 };
  if (typeof value.birthDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.birthDate)) return invalid;
  const [year, month, day] = value.birthDate.split("-").map(Number);
  const date = new Date(`${value.birthDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || year < 1900 || date.getUTCFullYear() !== year ||
      date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return invalid;
  const today = now.toISOString().slice(0, 10);
  if (value.birthDate > today) return invalid;
  // Calendar birthday in UTC, not elapsed milliseconds or Date's leap-day rollover.
  // A Feb 29 birthday reaches 18 on March 1 in a non-leap year.
  const age = now.getUTCFullYear() - year - (today.slice(5) < value.birthDate.slice(5) ? 1 : 0);
  if (age < 18) return { code: "AGE_INELIGIBLE", error: "KakaReel is only available to people aged 18 or older.", status: 403 };
  return null;
}
