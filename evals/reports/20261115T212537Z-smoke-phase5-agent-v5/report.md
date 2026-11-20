# Live smoke: phase5-agent-v5

- Started: 2026-11-15T21:25:37.409Z
- API: http://localhost:4000 (llmMode live)
- Result: PASS
- Ask stream: 4 progress, 1 answer, 0 error events
- Drafts: master_instruction, supplier_confirmation

## Step latency

| Step | Latency | Target | Within |
|---|---:|---:|---|
| email-1 | 3.1s | 20.0s | yes |
| email-2 | 5.1s | 20.0s | yes |
| ask | 5.9s | 45.0s | yes |
| approve | 0.0s | - | - |

## By purpose

| Purpose | Model | Calls | Input tok | Output tok | Cache read | Cache write | Latency | Cost USD |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| extract | claude-haiku-5-5 | 2 | 382 | 1629 | 3064 | 3064 | 7.2s | 0.001266 |
| agent | claude-haiku-5-5 | 3 | 6394 | 1180 | 16518 | 0 | 5.8s | 0.001395 |
| **total** | | 5 | 6776 | 2809 | | | 13.0s | 0.002661 (cap 0.25) |

## Model calls

| Id | Purpose | Model | Mode | Input | Output | Cache read | Cache write | Latency | Cost USD | Stop |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | extract | claude-haiku-5-5 | live | 207 | 511 | 0 | 3064 | 2.4s | 0.000659 | end_turn |
| 2 | extract | claude-haiku-5-5 | live | 175 | 1118 | 3064 | 0 | 4.8s | 0.000607 | end_turn |
| 3 | agent | claude-haiku-5-5 | live | 100 | 116 | 5506 | 0 | 1.1s | 0.000123 | tool_use |
| 4 | agent | claude-haiku-5-5 | live | 2785 | 574 | 5506 | 0 | 2.6s | 0.000621 | tool_use |
| 5 | agent | claude-haiku-5-5 | live | 3509 | 490 | 5506 | 0 | 2.2s | 0.000651 | end_turn |
