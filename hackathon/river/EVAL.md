# Eval — base vs LoRA

Base: `Qwen/Qwen3.5-9B`. LoRA: rank 32, 56 steps, batch 32, lr 2e-4,
loss 2.29 → 0.0031 (train). Checkpoint `bookkeeper-v1`.

Held-out set: `data/eval.jsonl`, 50 examples never trained on — 25 public bank
transactions (gold = category) and 25 synthetic client-coding prompts (gold =
GL code, or `REVIEW` for unknown vendors). Both models got the identical
system+user messages, thinking disabled, max_tokens 200. Scored by substring
match of the gold label/code in the response.

| | public (25) | client GL (25) | all (50) |
|---|---|---|---|
| base | 17 (68%) | 22 (88%) | **39 (78%)** |
| LoRA | 24 (96%) | 24 (96%) | **48 (96%)** |

Format adherence (what actually makes it usable in a pipeline):

| | house format on client prompts | `Category:` prefix on public | avg response length |
|---|---|---|---|
| base | 1/25 | 1/25 | 492 chars |
| LoRA | 25/25 | 25/25 | 114 chars |

## Honest caveats

- n=50. Differences of a couple of points are noise; the format numbers are not.
- The base model's 88% on client GL prompts is inflated: the gold code is often
  present in the injected rules/memory block, and the base model's long rambling
  answer quotes it somewhere. Substring match rewards that. The LoRA answers in
  4 lines and still hits 96%.
- The public-dataset rationale sentences are templated, so the LoRA learned a
  formulaic reason string for that branch. The client-coding branch cites real
  rules from `entities/*/rules.md`.
- Synthetic client examples are generated from this repo's vendor defaults and
  rules, so the LoRA has effectively memorized those three clients' vendor→GL
  maps. Generalization to a fourth client is untested.
