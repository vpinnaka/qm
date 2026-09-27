#!/usr/bin/env python3
"""Base vs LoRA accuracy on the held-out eval set (category for public rows, GL code for synth)."""
import json, os, re, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import river_client

ROOT = Path(__file__).resolve().parent
BASE = os.environ.get("RIVER_BASE_MODEL", "Qwen/Qwen3.5-9B")
CKPT = (ROOT / "checkpoint.txt").read_text().strip()
N = int(sys.argv[1]) if len(sys.argv) > 1 else 50
client = river_client.Client(api_key=os.environ["RIVER_API_KEY"])
KW = dict(max_tokens=200, chat_template_kwargs={"enable_thinking": False})


def ask(msgs, lora):
    try:
        r = (client.chat_complete_from_checkpoint(msgs, checkpoint_path=CKPT, base_model=BASE, **KW)
             if lora else client.chat_complete(msgs, base_model=BASE, **KW))
        m = json.loads(r.response_json)["choices"][0]["message"]
        return m.get("content") or m.get("reasoning_content") or ""
    except Exception as e:
        return f"__ERROR__ {e}"


def correct(row, out):
    gold = row["gold"]
    if row["kind"] == "synth":
        if gold == "REVIEW":
            return "review" in out.lower() or "flag" in out.lower()
        return bool(re.search(rf"\b{gold}\b", out))
    return gold.lower() in out.lower()


def main():
    rows = [json.loads(l) for l in open(ROOT / "data/eval.jsonl")][:N]
    prompts = [r["messages"][:2] for r in rows]

    def run(lora):
        with ThreadPoolExecutor(8) as ex:
            return list(ex.map(lambda m: ask(m, lora), prompts))

    res = {}
    for label, lora in (("base", False), ("lora", True)):
        outs = run(lora)
        res[label] = outs
        for kind in ("public", "synth", "all"):
            idx = [i for i, r in enumerate(rows) if kind in (r["kind"], "all")]
            hits = sum(correct(rows[i], outs[i]) for i in idx)
            print(f"{label:5s} {kind:7s} {hits}/{len(idx)} = {hits/len(idx):.0%}")
    json.dump({"rows": rows, **res}, open(ROOT / "data/eval_out.json", "w"), indent=1)


if __name__ == "__main__":
    main()
