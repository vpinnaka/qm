#!/usr/bin/env python3
"""LoRA SFT for the LedgerLoop bookkeeper on River. Logs to stdout (-> train.log).

Saves checkpoint 'bookkeeper-v1' after EARLY_AT steps and again at the end, writing
the latest path to river/checkpoint.txt so the proxy can pick it up.
"""
import json, os, time, sys
from pathlib import Path

import river_client
from river_client.renderers import get_renderer

ROOT = Path(__file__).resolve().parent
BASE = os.environ.get("RIVER_BASE_MODEL", "Qwen/Qwen3.5-9B")
BATCH = int(os.environ.get("BATCH", 32))
LR = float(os.environ.get("LR", 2e-4))
RANK = int(os.environ.get("RANK", 32))
EARLY_AT = 10
WALL_BUDGET_S = float(os.environ.get("WALL_BUDGET_S", 1500))  # 25 min of stepping
MAX_LEN = 2048


def log(*a):
    print(*a, flush=True)


def main():
    rows = [json.loads(l) for l in open(ROOT / "data/train.jsonl")]
    rend = get_renderer(BASE, thinking=False)
    data = []
    for r in rows:
        ex = rend.build_training_example(r["messages"], max_length=MAX_LEN).to_dict()
        data.append(ex)
    log(f"rendered {len(data)} examples, base={BASE} rank={RANK} batch={BATCH} lr={LR}")

    client = river_client.Client(api_key=os.environ["RIVER_API_KEY"])
    with client.session(project="ledgerloop-bookkeeper") as session:
        model = session.create_model(base_model=BASE, lora=river_client.LoraConfig(rank=RANK))
        t0 = time.time()
        step = 0
        ckpt = None
        nsteps = len(data) // BATCH
        for i in range(nsteps):
            batch = data[i * BATCH:(i + 1) * BATCH]
            fb = model.forward_backward(batch, loss_fn="cross_entropy")
            model.optim_step(lr=LR, grad_clip_norm=1.0)
            step += 1
            loss = getattr(fb, "loss", None)
            if loss is None:
                loss = getattr(fb, "metrics", {})
            log(f"step {step}/{nsteps} loss={loss} elapsed={time.time()-t0:.0f}s")
            if step == EARLY_AT or step == nsteps or time.time() - t0 > WALL_BUDGET_S:
                ckpt = model.save_weights("bookkeeper-v1", mode="inference")
                path = getattr(ckpt, "path", str(ckpt))
                (ROOT / "checkpoint.txt").write_text(path + "\n")
                log(f"SAVED step={step} checkpoint={path}")
            if time.time() - t0 > WALL_BUDGET_S:
                log("wall budget hit, stopping")
                break
        log("done")


if __name__ == "__main__":
    main()
