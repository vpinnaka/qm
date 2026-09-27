import assert from "node:assert/strict";
import test from "node:test";
import {
  clientBrief,
  clientFacts,
  DEMO_CLIENT_PROFILE,
  EMPTY_CLIENT_PROFILE,
  type ClientProfile,
} from "../src/client-brief.ts";

const profile: ClientProfile = {
  ...EMPTY_CLIENT_PROFILE,
  name: "Northwind Bakery",
  entityType: "S-Corp",
  industry: "food manufacturing",
  fiscalYearEnd: "December 31",
  basis: "accrual",
  closeCadence: "monthly",
  autoPostThreshold: "0.85",
  instructions:
    "6100 Auto is vehicles only\nShell / fuel card -> 6120 Fuel, not 6100 Auto\n- Gusto -> 6000 Payroll\n\nAsk before touching prior closed periods",
};

test("client brief carries every field as agent instructions", () => {
  const brief = clientBrief(profile);
  assert.match(brief, /^# Client brief: Northwind Bakery/);
  assert.match(brief, /- Entity type: S-Corp/);
  assert.match(brief, /- Industry: food manufacturing/);
  assert.match(brief, /- Fiscal year end: December 31/);
  assert.match(brief, /- Accounting basis: accrual/);
  assert.match(brief, /- Close cadence: monthly/);
  assert.match(brief, /confidence is at least 0\.85/);
  assert.match(brief, /## Client instructions/);
  assert.match(brief, /- Shell \/ fuel card -> 6120 Fuel, not 6100 Auto/);
  assert.match(brief, /- Gusto -> 6000 Payroll/);
  assert.match(brief, /- Ask before touching prior closed periods/);
});

test("client brief omits empty optional sections", () => {
  const brief = clientBrief({ ...EMPTY_CLIENT_PROFILE, name: "Acme" });
  assert.doesNotMatch(brief, /Client instructions/);
  assert.doesNotMatch(brief, /Industry:/);
});

test("client facts are one seedable line per rule plus profile facts", () => {
  const facts = clientFacts(profile);
  assert.ok(facts.every((fact) => fact.trim() === fact && fact.length > 0));
  assert.deepEqual(facts.slice(4), [
    "6100 Auto is vehicles only",
    "Shell / fuel card -> 6120 Fuel, not 6100 Auto",
    "Gusto -> 6000 Payroll",
    "Ask before touching prior closed periods",
  ]);
  assert.match(facts[0]!, /Northwind Bakery is a S-Corp in food manufacturing\./);
  assert.match(facts[3]!, /confidence 0\.85 or above/);
});

test("demo client fills every field", () => {
  assert.ok(Object.values(DEMO_CLIENT_PROFILE).every((value) => value.trim()));
  assert.match(clientBrief(DEMO_CLIENT_PROFILE), /- Shell \/ fuel card -> 6120 Fuel/);
});
