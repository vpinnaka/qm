const ADAPTER = process.env.GBRAIN_ADAPTER_URL ?? "http://127.0.0.1:8789";
const TOKEN = process.env.GBRAIN_SEED_TOKEN ?? "";

const CLIENTS = {
  northwind: {
    clientName: "Northwind Bakery LLC",
    facts: [
      "Northwind Bakery LLC is a wholesale and retail bakery; owner is Sarah Chen (sarah@northwindbakery.example).",
      "Northwind confidence threshold for auto-posting is 0.82; monthly close package is due to the owner by EOD the 5th, bills coded by the 3rd.",
      "Northwind vendor GL defaults: Sunrise Flour Mills 5010, Pacific Coast Dairy 5020, BakePac Packaging Co 5030, City Gas and Electric 6100, Metro Water Authority 6115, Pacific Power Inc 6110, Lakeside Commercial Rentals 6200, State Farm Insurance 7100, Office Depot 7110, Smith and Associates CPA 7400, BakeRight Equipment Co 7300, Local Print and Design 7200.",
      "Northwind coding quirk: flour and grain purchases always post to 5010 even when the memo says 'ingredients'; dairy and eggs both post to 5020 with a memo note.",
      "Northwind coding quirk: packaging tape, boxes and bags post to 5030, never to office supplies 7110.",
      "Northwind equipment repairs under $500 post to 7300; over $500 check with the owner before coding.",
      "Northwind approvals: auto-approve bills under $1,000 for approved vendors, $1,000-$5,000 need owner review, over $5,000 need written owner approval.",
      "Northwind reconciles the bank account ending -4821 and has no corporate card: all vendor payments are ACH or check. Wholesale invoices are NET-30.",
    ],
  },
  cobalt: {
    clientName: "Cobalt Freight Co",
    facts: [
      "Cobalt Freight Co is a trucking and freight company; CFO is Marcus Williams (marcus@cobaltfreight.example).",
      "Cobalt confidence threshold for auto-posting is 0.75; fuel card transactions are reconciled by the 5th and the close package goes to the CFO by EOD the 7th.",
      "CRITICAL Cobalt rule: all fuel card transactions from Western Fuel Network or FleetNet Card Services code to 6120 (Fuel - Fleet Vehicles), NEVER 6100 (Utilities - Office). Auditors flag this every quarter.",
      "Cobalt vendor GL defaults: Western Fuel Network 6120, FleetNet Card Services 6120, Pacific Gas and Electric 6100, Valley Power and Light 6110, Peterbilt of Sacramento 6200, Road and Fleet Tires 6210, Central Valley Yard Rentals 6300, National Commercial Insurance 6400, Cargo Shield Insurance 6410, DOT Compliance Partners 6500, Oracle NetSuite 7200, Indeed Staffing Services 7300.",
      "Cobalt fleet maintenance split: tires, wheels and rims 6210; engine, transmission and drivetrain 6220; everything else (oil change, inspection, wash) 6200.",
      "Cobalt Pacific Gas and Electric bills post to 6110 when the memo says 'yard' or 'dispatch', otherwise 6100.",
      "Cobalt approvals: fuel card transactions auto-approve for approved vendors at confidence >= 0.75; maintenance bills auto under $2,500 for approved vendors; insurance premiums auto within 5% of prior month.",
      "Cobalt reconciles three bank accounts: ops -7744, payroll -2291, fuel -9903. Driver payroll runs biweekly and needs a month-end accrual mid-cycle. Equipment purchases over $5,000 are capitalized, not expensed.",
    ],
  },
};

const args = process.argv.slice(2);
const scopeIds = {
  northwind: args[0] ?? "group:web-project-northwind",
  cobalt: args[1] ?? "group:web-project-cobalt",
};

for (const [key, client] of Object.entries(CLIENTS)) {
  const scopeId = scopeIds[key as keyof typeof scopeIds];
  const res = await fetch(`${ADAPTER}/clients/seed`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ scopeId, ...client }),
  });
  console.log(scopeId, res.status, await res.text());
}
