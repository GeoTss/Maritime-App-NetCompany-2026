# Live smoke: track3-v4-v6

- Started: 2026-11-19T12:27:02.862Z
- API: http://localhost:4000 (llmMode live)
- Result: PASS
- Ask stream: 4 progress, 1 answer, 0 error events
- Drafts: master_instruction, supplier_confirmation

## Step latency

| Step | Latency | Target | Within |
|---|---:|---:|---|
| email-1 | 10.1s | 20.0s | yes |
| email-2 | 5.0s | 20.0s | yes |
| ask | 6.5s | 45.0s | yes |
| approve | 0.0s | - | - |

## By purpose

| Purpose | Model | Calls | Input tok | Output tok | Cache read | Cache write | Latency | Cost USD |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| extract | claude-haiku-5-5 | 2 | 382 | 2267 | 3991 | 3991 | 14.2s | 0.001710 |
| agent | claude-haiku-5-5 | 3 | 7162 | 1501 | 12278 | 6139 | 6.4s | 0.002357 |
| **total** | | 5 | 7544 | 3768 | | | 20.5s | 0.004067 (cap 0.25) |

## Model calls

| Id | Purpose | Model | Mode | Input | Output | Cache read | Cache write | Latency | Cost USD | Stop |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | extract | claude-haiku-5-5 | live | 207 | 1139 | 0 | 3991 | 9.9s | 0.001089 | end_turn |
| 2 | extract | claude-haiku-5-5 | live | 175 | 1128 | 3991 | 0 | 4.3s | 0.000621 | end_turn |
| 3 | agent | claude-haiku-5-5 | live | 100 | 126 | 0 | 6139 | 1.0s | 0.000840 | tool_use |
| 4 | agent | claude-haiku-5-5 | live | 3198 | 516 | 6139 | 0 | 2.1s | 0.000639 | tool_use |
| 5 | agent | claude-haiku-5-5 | live | 3864 | 859 | 6139 | 0 | 3.3s | 0.000877 | end_turn |
