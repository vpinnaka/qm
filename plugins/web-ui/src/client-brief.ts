export interface ClientProfile {
  name: string;
  entityType: string;
  industry: string;
  fiscalYearEnd: string;
  basis: string;
  closeCadence: string;
  autoPostThreshold: string;
  chartNotes: string;
  vendorRules: string;
  preferences: string;
}

export const EMPTY_CLIENT_PROFILE: ClientProfile = {
  name: "",
  entityType: "LLC",
  industry: "",
  fiscalYearEnd: "December 31",
  basis: "accrual",
  closeCadence: "monthly",
  autoPostThreshold: "0.9",
  chartNotes: "",
  vendorRules: "",
  preferences: "",
};

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean);
}

function bullets(value: string): string {
  return lines(value)
    .map((line) => `- ${line}`)
    .join("\n");
}

export function clientBrief(profile: ClientProfile): string {
  const name = profile.name.trim() || "This client";
  const sections: string[] = [
    `# Client brief: ${name}`,
    "You are the bookkeeping agent for this client. Follow this brief on every task in this workspace.",
    [
      "## Profile",
      `- Entity type: ${profile.entityType}`,
      ...(profile.industry.trim() ? [`- Industry: ${profile.industry.trim()}`] : []),
      `- Fiscal year end: ${profile.fiscalYearEnd}`,
      `- Accounting basis: ${profile.basis}`,
      `- Close cadence: ${profile.closeCadence}`,
    ].join("\n"),
    [
      "## Posting rules",
      `- Auto-post entries only when your confidence is at least ${profile.autoPostThreshold}; below that, queue the entry for review and say why.`,
      "- Never invent an account, vendor, or amount. Ask when the source document is ambiguous.",
      "- Cite the source document for every entry you propose.",
    ].join("\n"),
  ];
  if (profile.chartNotes.trim()) sections.push(["## Chart of accounts notes", bullets(profile.chartNotes)].join("\n"));
  if (profile.vendorRules.trim())
    sections.push(
      ["## Vendor coding rules", "Apply these before any general heuristic.", bullets(profile.vendorRules)].join("\n"),
    );
  if (profile.preferences.trim()) sections.push(["## Other preferences", bullets(profile.preferences)].join("\n"));
  return `${sections.join("\n\n")}\n`;
}

export function clientFacts(profile: ClientProfile): string[] {
  const name = profile.name.trim() || "This client";
  return [
    `${name} is a ${profile.entityType}${profile.industry.trim() ? ` in ${profile.industry.trim()}` : ""}.`,
    `${name} keeps books on the ${profile.basis} basis with a fiscal year ending ${profile.fiscalYearEnd}.`,
    `${name} closes ${profile.closeCadence}.`,
    `Auto-post entries for ${name} only at confidence ${profile.autoPostThreshold} or above.`,
    ...lines(profile.chartNotes),
    ...lines(profile.vendorRules),
    ...lines(profile.preferences),
  ];
}
