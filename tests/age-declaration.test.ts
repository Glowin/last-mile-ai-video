import { test } from "node:test";
import assert from "node:assert/strict";
import { AGE_POLICY_VERSION, validateAgeDeclaration } from "../src/lib/age-declaration";
const now = new Date("2026-10-26T00:00:00Z");
const age = (birthDate: unknown) => ({ birthDate, confirmed: true, policyVersion: AGE_POLICY_VERSION });
test("age gate requires an explicit current declaration, not truthy confirmation", () => {
  for (const value of [undefined, null, {}, { ...age("2000-01-01"), confirmed: false },
    { ...age("2000-01-01"), confirmed: "true" }, { ...age("2000-01-01"), policyVersion: "old" }])
    assert.equal(validateAgeDeclaration(value, now)?.code, "AGE_REQUIRED");
});
test("server rejects fabricated dates, rollover, future dates and timestamps", () => {
  for (const value of ["2001-02-29", "2000-02-30", "2000-13-01", "2000-00-01", "2000-01-00",
    "2000-04-31", "2000-1-01", "2000-01-01T00:00:00Z", "2026-10-27", "0000-01-01", 20000101])
    assert.equal(validateAgeDeclaration(age(value), now)?.code, "AGE_INVALID", String(value));
});
test("18th birthday passes in UTC, day before and younger fail; leap birthday uses March 1", () => {
  assert.equal(validateAgeDeclaration(age("2008-10-26"), now), null);
  assert.equal(validateAgeDeclaration(age("2008-10-27"), now)?.code, "AGE_INELIGIBLE");
  assert.equal(validateAgeDeclaration(age("2020-01-01"), now)?.code, "AGE_INELIGIBLE");
  assert.equal(validateAgeDeclaration(age("2000-02-29"), new Date("2018-02-28T23:59:59Z"))?.code, "AGE_INELIGIBLE");
  assert.equal(validateAgeDeclaration(age("2000-02-29"), new Date("2018-03-01T00:00:00Z")), null);
});
