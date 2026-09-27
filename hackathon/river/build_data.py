#!/usr/bin/env python3
"""Build chat-SFT jsonl for the LedgerLoop bookkeeper LoRA.

Two sources:
  (a) public HF dataset us-bank-transaction-categories-v2 (MIT) -> category + rationale
  (b) synthetic examples from this repo's entities/ (coa, vendors, rules) -> GL coding
      with a "## Client memory" + "## Client rules" system prompt.

Outputs river/data/{train,eval}.jsonl as {"messages": [...], "kind": ..., "gold": ...}.
"""
import csv, json, random, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
OUT = ROOT / "data"
N_PUBLIC, N_SYNTH, N_EVAL_PUBLIC, N_EVAL_SYNTH = 1500, 300, 25, 25
rng = random.Random(7)

BASE_SYS = "You are LedgerLoop, a bookkeeping assistant. Be concise and cite the client rule you applied. Flag for review when uncertain."


def sysmsg(memory: str = "(none)", rules: str = "(none)") -> str:
    return f"{BASE_SYS}\n\n## Client memory\n{memory}\n\n## Client rules\n{rules}"


# ---------- (a) public transactions ----------
CAT_HINT = {
    "Insurance": "insurance carrier debit",
    "Mortgage": "mortgage servicer payment",
    "Utilities": "utility / waste / power biller",
    "Entertainment": "entertainment or gaming merchant",
}


def public_rows():
    rows = []
    with open(OUT / "tx.csv", newline="") as f:
        for r in csv.DictReader(f):
            d, c = r["description"].strip(), r["category"].strip()
            if d and c:
                rows.append((d, c))
    rng.shuffle(rows)
    return rows[: N_PUBLIC + N_EVAL_PUBLIC]


def public_example(desc, cat):
    merchant = re.sub(r"^\[(debit|credit)\]\s*", "", desc)
    token = " ".join(merchant.split()[:2])
    hint = CAT_HINT.get(cat, f"recurring {cat.lower()} spend")
    return {
        "kind": "public",
        "gold": cat,
        "messages": [
            {"role": "system", "content": sysmsg()},
            {"role": "user", "content": f"Categorize this bank transaction for the books:\n{desc}"},
            {"role": "assistant", "content": f"Category: {cat}\nReason: \"{token}\" is a {hint}."},
        ],
    }


# ---------- (b) synthetic client examples ----------
def load_entities():
    ents = {}
    for d in sorted((REPO / "entities").iterdir()):
        if not d.is_dir():
            continue
        coa = {a["code"]: a["name"] for a in json.loads((d / "coa.json").read_text())}
        vendors = json.loads((d / "vendors.json").read_text())["vendors"]
        rules = (d / "rules.md").read_text()
        ents[d.name] = {"coa": coa, "vendors": vendors, "rules": rules}
    return ents


def rules_block(rules_md: str) -> str:
    """Coding-relevant slice of rules.md (skip the close checklist)."""
    keep, on = [], False
    for line in rules_md.splitlines():
        if line.startswith("## "):
            on = any(k in line for k in ("Coding", "Fuel", "Split", "Approval"))
        if on and line.strip():
            keep.append(line)
    return "\n".join(keep[:22]) or rules_md[:600]


MEMO_HINTS = [
    ("yard", "6110"), ("dispatch", "6110"), ("tires", "6210"), ("wheel", "6210"),
    ("engine", "6220"), ("transmission", "6220"), ("oil change", "6200"),
]


def synth_example(ent_name, ent, vendor, meta, i):
    amount = round(rng.uniform(85, 4800), 2)
    gl = meta["default_gl"]
    conf = meta["confidence_prior"]
    memo = rng.choice(["monthly statement", "invoice", "card settlement", "regular delivery", "yard service", "tires replacement"])
    reason = f"{vendor} maps to {gl} in this client's vendor defaults"

    # Memo overrides from the cobalt rules (teaches rule precedence over vendor default).
    if ent_name == "cobalt-freight":
        for kw, code in MEMO_HINTS:
            if kw in memo and code in ent["coa"] and gl.startswith("6"):
                gl, conf = code, 0.93
                reason = f'memo says "{kw}", and the client rule routes that to {code} over the vendor default'
                break
        if gl == "6120":
            reason = 'client rule: ALL fuel card transactions from this vendor code to 6120 (Fuel - Fleet Vehicles), NEVER 6100'

    name = ent["coa"].get(gl, "")
    memory = f"- Entity: {ent_name}\n- Approved vendor: {vendor} (default GL {meta['default_gl']}, prior {meta['confidence_prior']})\n- Prior month coded {rng.randint(2, 19)} bills from this vendor to {meta['default_gl']}"
    ask = rng.choice([
        f"Code this bill: {vendor} ${amount} — memo \"{memo}\"",
        f"What GL for {vendor} ${amount}? memo: {memo}",
        f"Bill from {vendor} for ${amount}, memo \"{memo}\". Code it.",
    ])
    ans = (f"GL {gl} — {name}\nAmount: ${amount}\nConfidence: {conf}\n"
           f"Reason: {reason}.")
    return {"kind": "synth", "gold": gl, "messages": [
        {"role": "system", "content": sysmsg(memory, rules_block(ent["rules"]))},
        {"role": "user", "content": ask},
        {"role": "assistant", "content": ans},
    ]}


def unknown_vendor_example(ent_name, ent):
    """Teach flag-for-review when the vendor isn't in memory."""
    vendor = rng.choice(["Cascade Logistics Partners", "Blue Ridge Supply Co", "Vertex Consulting Group"])
    amount = round(rng.uniform(300, 6000), 2)
    memory = f"- Entity: {ent_name}\n- No prior history for this vendor"
    return {"kind": "synth", "gold": "REVIEW", "messages": [
        {"role": "system", "content": sysmsg(memory, rules_block(ent["rules"]))},
        {"role": "user", "content": f"Code this bill: {vendor} ${amount} — memo \"professional services\""},
        {"role": "assistant", "content": (
            "FLAG FOR REVIEW\nAmount: $%s\nConfidence: 0.35\n"
            "Reason: %s is not in this client's vendor defaults and no client rule covers it; needs a human coding decision."
            % (amount, vendor))},
    ]}


def main():
    pub = [public_example(d, c) for d, c in public_rows()]
    ents = load_entities()
    synth = []
    i = 0
    while len(synth) < N_SYNTH + N_EVAL_SYNTH:
        ent_name = rng.choice(list(ents))
        ent = ents[ent_name]
        if rng.random() < 0.12:
            synth.append(unknown_vendor_example(ent_name, ent))
        else:
            vendor, meta = rng.choice(list(ent["vendors"].items()))
            synth.append(synth_example(ent_name, ent, vendor, meta, i))
        i += 1

    ev = pub[:N_EVAL_PUBLIC] + synth[:N_EVAL_SYNTH]
    tr = pub[N_EVAL_PUBLIC:] + synth[N_EVAL_SYNTH:]
    rng.shuffle(tr)
    for name, rows in (("train", tr), ("eval", ev)):
        with open(OUT / f"{name}.jsonl", "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
        print(name, len(rows))


if __name__ == "__main__":
    main()
