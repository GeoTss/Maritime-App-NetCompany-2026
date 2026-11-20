# Live smoke: phase4-agent-v3

- Started: 2026-11-15T18:28:33.694Z
- API: http://localhost:4000 (llmMode live)
- Result: PASS
- Ask stream: 6 progress, 1 answer, 0 error events
- Drafts: master_instruction, supplier_confirmation

## Step latency

| Step | Latency | Target | Within |
|---|---:|---:|---|
| email-1 | 3.1s | 20.0s | yes |
| email-2 | 5.1s | 20.0s | yes |
| ask | 9.8s | 45.0s | yes |
| approve | 0.0s | - | - |

## By purpose

| Purpose | Model | Calls | Input tok | Output tok | Cache read | Cache write | Latency | Cost USD |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| extract | claude-haiku-5-5 | 2 | 382 | 1603 | 3064 | 3064 | 6.9s | 0.001253 |
| agent | claude-haiku-5-5 | 4 | 11700 | 2214 | 15684 | 0 | 9.7s | 0.002434 |
| **total** | | 6 | 12082 | 3817 | | | 16.6s | 0.003687 (cap 0.25) |

## Model calls

| Id | Purpose | Model | Mode | Input | Output | Cache read | Cache write | Latency | Cost USD | Stop |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | extract | claude-haiku-5-5 | live | 207 | 511 | 0 | 3064 | 2.4s | 0.000659 | end_turn |
| 2 | extract | claude-haiku-5-5 | live | 175 | 1092 | 3064 | 0 | 4.5s | 0.000594 | end_turn |
| 3 | agent | claude-haiku-5-5 | live | 100 | 126 | 3921 | 0 | 1.1s | 0.000112 | tool_use |
| 4 | agent | claude-haiku-5-5 | live | 2795 | 596 | 3921 | 0 | 2.4s | 0.000617 | tool_use |
| 5 | agent | claude-haiku-5-5 | live | 3876 | 896 | 3921 | 0 | 3.5s | 0.000875 | end_turn |
| 6 | agent | claude-haiku-5-5 | live | 4929 | 596 | 3921 | 0 | 2.7s | 0.000830 | end_turn |
