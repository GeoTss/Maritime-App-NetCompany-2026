# Live smoke: phase5-agent-v4

- Started: 2026-11-15T20:20:34.750Z
- API: http://localhost:4000 (llmMode live)
- Result: PASS
- Ask stream: 6 progress, 1 answer, 0 error events
- Drafts: master_instruction, supplier_confirmation

## Step latency

| Step | Latency | Target | Within |
|---|---:|---:|---|
| email-1 | 3.1s | 20.0s | yes |
| email-2 | 4.1s | 20.0s | yes |
| ask | 6.4s | 45.0s | yes |
| approve | 0.0s | - | - |

## By purpose

| Purpose | Model | Calls | Input tok | Output tok | Cache read | Cache write | Latency | Cost USD |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| extract | claude-haiku-5-5 | 2 | 382 | 1499 | 3064 | 3064 | 6.0s | 0.001201 |
| agent | claude-haiku-5-5 | 3 | 6970 | 1360 | 16185 | 0 | 6.3s | 0.001539 |
| **total** | | 5 | 7352 | 2859 | | | 12.3s | 0.002740 (cap 0.25) |

## Model calls

| Id | Purpose | Model | Mode | Input | Output | Cache read | Cache write | Latency | Cost USD | Stop |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | extract | claude-haiku-5-5 | live | 207 | 511 | 0 | 3064 | 2.3s | 0.000659 | end_turn |
| 2 | extract | claude-haiku-5-5 | live | 175 | 988 | 3064 | 0 | 3.7s | 0.000542 | end_turn |
| 3 | agent | claude-haiku-5-5 | live | 100 | 124 | 5395 | 0 | 1.0s | 0.000126 | tool_use |
| 4 | agent | claude-haiku-5-5 | live | 2793 | 799 | 5395 | 0 | 3.3s | 0.000733 | tool_use |
| 5 | agent | claude-haiku-5-5 | live | 4077 | 437 | 5395 | 0 | 2.0s | 0.000680 | end_turn |
