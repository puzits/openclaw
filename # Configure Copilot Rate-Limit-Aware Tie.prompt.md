# Configure Copilot Rate-Limit-Aware Tier Routing

## Context

OpenClaw currently selects a single main model per agent run. The agent can spawn sub-agents via `sessions_spawn` with a `complexity` parameter (`simple` / `medium` / `complex`), and the existing infrastructure resolves each complexity level to a configured model. This system is fully wired end-to-end — no code changes needed beyond a one-line Zod schema fix (see below).

GitHub Copilot models have **premium request multipliers** that act as a rate-limit budget. Different models consume different amounts of your monthly premium request allowance. Routing simple sub-agent tasks to **0x (free) models** preserves budget for tasks that need stronger models.

## Copilot Premium Request Multipliers (Paid Plans)

| Multiplier    | Models                                                     | Budget Impact                         |
| ------------- | ---------------------------------------------------------- | ------------------------------------- |
| **0x (FREE)** | GPT-4.1, GPT-4o, GPT-5 mini                                | No premium requests consumed          |
| **0.33x**     | Claude Haiku 4.5, Gemini 3 Flash, Grok Code Fast 1         | 1 interaction = 0.33 premium requests |
| **1x**        | Claude Sonnet 4/4.5/4.6, Gemini 2.5/3 Pro, GPT-5.1/5.2/5.4 | 1 interaction = 1 premium request     |
| **3x**        | Claude Opus 4.5, Claude Opus 4.6                           | 1 interaction = 3 premium requests    |

Source: https://docs.github.com/en/copilot/concepts/billing/copilot-requests#model-multipliers

## Tier Mapping

| Tier                         | Model                              | Multiplier | Use Case                                                               |
| ---------------------------- | ---------------------------------- | ---------- | ---------------------------------------------------------------------- |
| **Main agent**               | `github-copilot/claude-sonnet-4.6` | 1x         | Primary agent — best capability-per-premium-request                    |
| **simple**                   | `github-copilot/gpt-4.1`           | 0x         | Classification, formatting, lookups, translation — **completely free** |
| **medium**                   | `github-copilot/claude-sonnet-4.5` | 1x         | General coding, summarization, drafting                                |
| **complex**                  | `github-copilot/claude-sonnet-4.6` | 1x         | Deep reasoning, architecture, debugging                                |
| **Fallback** (no complexity) | `github-copilot/gpt-4.1`           | 0x         | Default for unspecified — **free**                                     |

**Key optimization**: simple-tier and unspecified-complexity spawns consume **zero** premium requests. Only medium/complex spawns cost 1 premium request each.

**Optional upgrade**: Set `complex` tier to `github-copilot/claude-opus-4.6` (3x multiplier) for significantly stronger reasoning on truly hard tasks. Only if budget allows.

---

## Routing Tests (Live Evidence)

All three tiers were tested live on this machine. Session logs confirm correct model routing for each complexity level.

### Simple — `complexity="simple"` → `github-copilot/gpt-4.1` (0x FREE)

**Task:** Convert a list to uppercase: `apple, banana, cherry`

**Routed model:** `github-copilot/gpt-4.1` — zero premium requests consumed

**Sub-agent response:**

```
APPLE, BANANA, CHERRY
```

**Other simple tasks this tier handles well:**

- Classify sentiment of a string
- Reformat JSON / YAML
- Translate a short phrase
- Extract keywords from a paragraph
- Generate a commit message from a diff summary
- Check grammar / spelling

---

### Medium — `complexity="medium"` → `github-copilot/claude-sonnet-4.5` (1x)

**Task:** Write a TypeScript `parseDate(input: string): Date | null` function with ISO 8601 handling and JSDoc

**Routed model:** `github-copilot/claude-sonnet-4.5` — 1 premium request consumed

**Sub-agent response (excerpt):**

```
Created parseDate.ts with a TypeScript function that:
- Handles ISO 8601 formats: Date-only, date-time, and timezone variants
- Returns null for invalid input: Empty strings, malformed dates, or non-ISO 8601 formats
- Includes comprehensive JSDoc
```

**Other medium tasks this tier handles well:**

- Write unit tests for a module
- Summarize a long document
- Draft a PR description from a diff
- Implement a CRUD endpoint
- Refactor a file to follow a coding pattern
- Review code for common issues

---

### Complex — `complexity="complex"` → `github-copilot/claude-sonnet-4.6` (1x)

**Task:** Design a rate-limiting architecture for a multi-tenant API — compare token bucket vs sliding window algorithms, Redis vs in-memory trade-offs, and burst handling

**Routed model:** `github-copilot/claude-sonnet-4.6` — 1 premium request consumed

**Sub-agent response (excerpt):**

```
## Rate-Limiting Architecture for Multi-Tenant APIs

Algorithm Choice: Sliding Window + Token Bucket Hybrid

Token Bucket — best for burst absorption. Tokens accumulate up to a cap;
bursts drain the bucket, steady traffic refills it. Simple, forgiving, but
can allow short burst violations.

Burst handling: Token bucket allows controlled bursts (up to bucket capacity),
making it tenant-friendly; sliding window smooths traffic more strictly,
rejecting requests that exceed the rate across any rolling time window.
```

**Other complex tasks this tier handles well:**

- Architect a database schema with trade-off analysis
- Debug a subtle concurrency issue across multiple files
- Design an auth system (OAuth2 + JWT + refresh tokens)
- Evaluate and choose between competing implementation approaches
- Generate a comprehensive migration plan
- Analyze security vulnerabilities across a codebase

---

### Routing Summary

| Tier      | Model                              | Multiplier | Task Type                                                    | Premium Requests |
| --------- | ---------------------------------- | ---------- | ------------------------------------------------------------ | ---------------- |
| `simple`  | `github-copilot/gpt-4.1`           | **0x**     | Text transformation, classification, formatting, translation | **0**            |
| `medium`  | `github-copilot/claude-sonnet-4.5` | **1x**     | Coding, summarization, tests, CRUD, reviews                  | **1**            |
| `complex` | `github-copilot/claude-sonnet-4.6` | **1x**     | Architecture, deep reasoning, debugging, design              | **1**            |
| _(none)_  | `github-copilot/gpt-4.1`           | **0x**     | Unspecified — free fallback                                  | **0**            |

Key budget insight: any spawn that doesn't explicitly request `medium` or `complex` costs **zero** premium requests.

---

## Setup Steps

### 1. Build the project

```bash
npm install -g pnpm
cd /path/to/openclaw
pnpm install
pnpm build
```

### 2. Apply Zod schema fix

The `models: { simple, medium, complex }` sub-field was missing from the Zod validator (present in TypeScript types, absent in schema). Without this fix, `config set agents.defaults.subagents.models.*` fails with `Unrecognized key: "models"`.

**Files changed:**

- `src/config/zod-schema.agent-defaults.ts` — added `models` object to the `subagents` schema
- `src/config/zod-schema.agent-runtime.ts` — added `models` object to the per-agent `subagents` schema

After editing, rebuild: `pnpm build`

### 3. Authenticate with GitHub Copilot

```bash
node openclaw.mjs onboard --auth-choice github-copilot --flow quickstart --accept-risk
# Visit the printed URL and enter the device code
# Sets default model to github-copilot/gpt-4o after auth
```

### 4. Configure tier routing

```bash
# Main agent: best Copilot reasoning model (1x)
node openclaw.mjs config set agents.defaults.model '"github-copilot/claude-sonnet-4.6"'

# Sub-agent fallback: free GPT-4.1 when no complexity specified
node openclaw.mjs config set agents.defaults.subagents.model '"github-copilot/gpt-4.1"'

# Tier → model mapping
node openclaw.mjs config set 'agents.defaults.subagents.models.simple'  '"github-copilot/gpt-4.1"'
node openclaw.mjs config set 'agents.defaults.subagents.models.medium'  '"github-copilot/claude-sonnet-4.5"'
node openclaw.mjs config set 'agents.defaults.subagents.models.complex' '"github-copilot/claude-sonnet-4.6"'

# Spawn depth and concurrency
node openclaw.mjs config set agents.defaults.subagents.maxSpawnDepth 2
node openclaw.mjs config set agents.defaults.subagents.maxConcurrent 3
```

Equivalent `~/.openclaw/openclaw.json` (JSON5):

```json5
{
  agents: {
    defaults: {
      model: "github-copilot/claude-sonnet-4.6",
      subagents: {
        model: "github-copilot/gpt-4.1",
        maxSpawnDepth: 2,
        maxConcurrent: 3,
        models: {
          simple: "github-copilot/gpt-4.1",
          medium: "github-copilot/claude-sonnet-4.5",
          complex: "github-copilot/claude-sonnet-4.6",
        },
      },
    },
  },
}
```

### 5. Start the gateway

```bash
node openclaw.mjs gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &
# Confirm startup:
grep "agent model\|listening on" /tmp/openclaw-gateway.log
```

### 6. Verify

```bash
# Inspect config
node openclaw.mjs config get agents.defaults.subagents

# Quick agent smoke test
node openclaw.mjs agent --agent main --message "Say hello in one sentence."

# Check which models are available via Copilot
node openclaw.mjs channels status --probe
```

---

## Architecture (Existing System — No Code Changes Needed)

```
User prompt
    │
    ▼
┌────────────────────────────────────────────┐
│  Main Agent (claude-sonnet-4.6, 1x)        │
│  Decides task decomposition                │
│  sessions_spawn(complexity=..., task=...)  │
└─────────┬──────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────┐
│  resolveSubagentSpawnModelSelection()            │
│  1. Explicit model override → use as-is          │
│  2. complexity → resolveSubagentComplexityModel() │
│     ├─ per-agent  subagents.models[complexity]   │
│     └─ defaults   subagents.models[complexity]   │
│  3. subagents.model fallback                     │
│  4. Agent's primary model                        │
│  5. Global default                               │
└─────────┬────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────┐
│  Sub-Agent Runs                                  │
│  simple  → gpt-4.1            (0x, FREE) ✅      │
│  medium  → claude-sonnet-4.5  (1x)       ✅      │
│  complex → claude-sonnet-4.6  (1x)       ✅      │
│  (none)  → gpt-4.1            (0x, FREE) ✅      │
└──────────────────────────────────────────────────┘
```

---

## Known Issue Fixed: Zod Schema Gap

The `models: { simple, medium, complex }` field was defined in `src/config/types.agent-defaults.ts` (TypeScript type) and `src/config/types.agents.ts` (per-agent type) but **missing** from the Zod validators in:

- `src/config/zod-schema.agent-defaults.ts`
- `src/config/zod-schema.agent-runtime.ts`

This caused `config set agents.defaults.subagents.models.simple "..."` to fail at validation time with `Unrecognized key: "models"`. The fix adds the `models` object (with `simple`, `medium`, `complex` as optional `AgentModelSchema` fields) to both Zod schemas. This is a bugfix — the field was always intended to work.

---

## Future: Full Plan Implementation

The existing tier system works well for manual configuration. The full plan in `plan-multiAgentOrchestration.prompt.md` adds:

- **Automatic cost-aware routing** — model router picks cheapest model matching tier + capabilities
- **Model catalog enrichment** — cost/tier/capabilities on `ModelCatalogEntry`
- **Built-in tier presets** — no config needed for well-known models
- **Budget enforcement** — `budgetPerTask` / `costCeiling` limits
- **System prompt injection** — agent sees model catalog with multipliers to make informed tier choices
- **Plugin hook** — `before_subagent_model_resolve` for custom routing logic

For Copilot specifically, the `cost` fields could store the multiplier value (e.g., `{input: 3, output: 3}` for Opus) so automated routing optimizes for **premium request conservation** rather than dollar cost.
