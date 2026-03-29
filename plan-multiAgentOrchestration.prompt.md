# Multi-Agent Orchestration with Cost-Aware Model Routing

> **Status:** Draft  
> **Date:** 2026-03-08  
> **Location:** `docs/refactor/multi-agent-orchestration.md`

## Summary

OpenClaw currently selects a single main model per agent run. The agent can spawn sub-agents via `sessions_spawn`, but model selection is a static config waterfall — no cost awareness, no task-capability matching, no automatic tier routing.

This project adds **Perplexity Computer-style orchestration**: a hybrid system where:

- A **programmatic model router** handles cost/capability matching (cheapest model that meets requirements)
- The **agent itself** drives task decomposition via `sessions_spawn` with a new `tier` parameter
- The **system prompt** is enriched with model catalog + pricing data so the agent makes informed decisions

All changes build on existing infrastructure. No breaking changes to current config or behavior.

---

## Architecture

```
User prompt
    │
    ▼
┌─────────────────────────────┐
│  Main Agent (premium model) │
│  System prompt includes:    │
│  - Model catalog + pricing  │
│  - Tier descriptions        │
│  - Sub-agent guidelines     │
└─────────┬───────────────────┘
          │ sessions_spawn(tier="fast", task="summarize this doc")
          │ sessions_spawn(tier="premium", task="architect the DB schema")
          │ sessions_spawn(tier="standard", task="write unit tests")
          ▼
┌──────────────────────────┐
│  Model Router            │
│  (programmatic)          │
│  tier + capabilities     │
│  → cheapest capable      │
│    model resolution      │
└──────────┬───────────────┘
           ▼
┌──────────────────────────┐
│  Sub-Agent Runs          │
│  haiku (fast)            │
│  sonnet (standard)       │
│  opus (premium)          │
└──────────────────────────┘
```

---

## Tasks

### Task 1 — Add `tier` and `capabilities` to model config types

**Files:**

- `src/config/types.models.ts` — `ModelDefinitionConfig` (L34-L49)
- `src/config/types.agents-shared.ts` — `AgentModelConfig` (L8-L15)

**Changes:**

1. Add `tier?: "fast" | "standard" | "premium"` to `ModelDefinitionConfig`
2. Add `capabilities?: string[]` to `ModelDefinitionConfig` (tags: `"coding"`, `"reasoning"`, `"vision"`, `"summarization"`, `"translation"`, `"math"`)
3. Export a `ModelTier` type: `"fast" | "standard" | "premium"`

**Acceptance criteria:**

- Types compile (`pnpm build`)
- No existing config breaks (all fields optional)

---

### Task 2 — Enrich `ModelCatalogEntry` with cost + tier data

**Files:**

- `src/agents/model-catalog.ts` — `ModelCatalogEntry` type (L11-L18), `loadModelCatalog()` (L188-L277)

**Changes:**

1. Add optional fields to `ModelCatalogEntry`:
   - `cost?: { input: number; output: number }`
   - `tier?: ModelTier`
   - `capabilities?: string[]`
2. In `loadModelCatalog()`, merge cost/tier/capabilities from `ModelDefinitionConfig` (available via provider configs) into catalog entries
3. Add new export: `getModelsByTier(tier: ModelTier, cfg: OpenClawConfig): ModelCatalogEntry[]` — returns models filtered by tier, sorted by ascending cost

**Acceptance criteria:**

- `loadModelCatalog()` returns entries with cost data populated from config
- `getModelsByTier("fast", cfg)` returns cheapest models first
- Existing catalog consumers unaffected (new fields optional)

---

### Task 3 — Add built-in tier presets for well-known models

**Files:**

- New file: `src/agents/model-tiers.ts` (~100 LOC)

**Changes:**

1. Define a `DEFAULT_MODEL_TIERS` map: `Record<string, { tier: ModelTier; capabilities: string[] }>` covering major models:
   - **fast**: `claude-haiku-3-5`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gemini-2.5-flash`
   - **standard**: `claude-sonnet-4-5`, `gpt-4.1`, `gemini-2.5-pro`
   - **premium**: `claude-opus-4-6`, `o3`, `o4-mini` (reasoning), `gemini-2.5-pro` (reasoning mode)
2. Export `getDefaultTierForModel(modelId: string): ModelTier | undefined` — matches by substring (handles provider prefixes)
3. Export `getDefaultCapabilitiesForModel(modelId: string): string[]` — returns default capability tags
4. These presets are overridden by user config (config takes precedence)

**Acceptance criteria:**

- Known models get sensible defaults without any user config
- User config `tier`/`capabilities` overrides presets
- Unit tests for major model ID patterns

---

### Task 4 — Add `tier` and `requiredCapabilities` to `sessions_spawn` tool schema

**Files:**

- `src/agents/tools/sessions-spawn-tool.ts` — `SessionsSpawnToolSchema` (L23-L57), `createSessionsSpawnTool()` (L62-L170)

**Changes:**

1. Add to `SessionsSpawnToolSchema`:
   ```
   tier: Type.Optional(optionalStringEnum(["fast", "standard", "premium"]))
   requiredCapabilities: Type.Optional(Type.Array(Type.String()))
   ```
2. Update tool description to explain tier usage:
   > "Use `tier` for cost-optimized model routing: fast (simple/cheap tasks like summarization, translation), standard (general coding, analysis), premium (complex reasoning, architecture, debugging). Use `model` only when you need a specific model. `tier` and `model` are mutually exclusive."
3. Pass `tier` and `requiredCapabilities` through to `spawnSubagentDirect()` params
4. Validate mutual exclusivity: if both `model` and `tier` are set, return tool error

**Acceptance criteria:**

- Tool schema validates correctly
- `tier` param flows through to spawn
- Error if both `model` and `tier` provided
- Tool description guides the agent on when to use each tier

---

### Task 5 — Build the cost-aware model router

**Files:**

- New file: `src/agents/model-router.ts` (~200 LOC)

**Changes:**

1. Core function:

   ```
   resolveModelByTier(params: {
     tier: ModelTier;
     requiredCapabilities?: string[];
     cfg: OpenClawConfig;
     agentId: string;
   }): string | undefined
   ```

   Logic:
   - Load model catalog (cached `loadModelCatalog()`)
   - Filter by tier match (config tier → preset tier → auto-inferred tier)
   - Filter by required capabilities (if specified)
   - Filter by allowed model set (`buildAllowedModelSet()`)
   - Sort by cost ascending (`cost.input + cost.output`)
   - Return cheapest qualifying model ID, or `undefined` (fall back to default)

2. Auto-infer tier for models without explicit tier:
   - `reasoning === true && contextWindow >= 128k` → `"premium"`
   - `contextWindow >= 64k` → `"standard"`
   - Everything else → `"fast"`

3. Export `formatModelCatalogForPrompt(cfg: OpenClawConfig): string` — renders a markdown table of available models with tier, cost, capabilities for system prompt injection (Task 7)

**Acceptance criteria:**

- Given 3 models in "fast" tier with different costs, returns cheapest
- Capability filtering works (e.g., require "vision" excludes text-only models)
- Falls back gracefully when no model matches tier
- Unit tests for all branches

---

### Task 6 — Integrate router into spawn model resolution

**Files:**

- `src/agents/model-selection.ts` — `resolveSubagentSpawnModelSelection()` (L394-L413)
- `src/agents/subagent-spawn.ts` — `SpawnSubagentParams` (L44), spawn call (L380-L384)

**Changes:**

1. Extend `SpawnSubagentParams` with:
   - `tier?: ModelTier`
   - `requiredCapabilities?: string[]`
2. Update `resolveSubagentSpawnModelSelection()` signature to accept `tierOverride?` and `requiredCapabilities?`
3. New resolution priority:
   1. Explicit `modelOverride` → use as-is (unchanged)
   2. **NEW: `tierOverride`** → call `resolveModelByTier()` → if found, use it
   3. Per-agent subagent config → global subagent config → per-agent model → global model → default (unchanged)
4. In `spawnSubagentDirect()` at L380, pass `tier` and `requiredCapabilities` from params to the updated resolver

**Acceptance criteria:**

- `sessions_spawn(tier="fast", task="...")` resolves to cheapest fast-tier model
- `sessions_spawn(model="anthropic/claude-opus-4-6", task="...")` still works (model overrides tier)
- `sessions_spawn(task="...")` (no tier, no model) still uses existing config waterfall
- All existing tests pass

---

### Task 7 — Inject model catalog into agent system prompt

**Files:**

- `src/agents/system-prompt.ts` — `buildAgentSystemPrompt()` (L189), model aliases section (L494-L503)

**Changes:**

1. After the existing "Model Aliases" section (~L503), inject a new `## Available Models for Sub-Agents` section
2. Content: output of `formatModelCatalogForPrompt()` from Task 5 — a markdown table:
   ```
   | Model | Tier | Cost ($/M tokens) | Capabilities |
   |-------|------|--------------------|--------------|
   | claude-haiku-3-5 | fast | $0.25 in / $1.25 out | coding, summarization |
   | claude-sonnet-4-5 | standard | $3 in / $15 out | coding, reasoning, vision |
   | claude-opus-4-6 | premium | $15 in / $75 out | coding, reasoning, vision, math |
   ```
3. Add brief guidance text:
   > "When spawning sub-agents, use `tier` to optimize cost. Reserve `premium` for complex reasoning/architecture. Use `fast` for simple summarization, formatting, translation. Use `standard` for general coding tasks."
4. Only inject when `sessions_spawn` tool is available (check: not sandboxed, spawn depth < max)

**Acceptance criteria:**

- Agent system prompt includes model catalog when `sessions_spawn` is active
- Prompt does NOT include catalog when sub-agent spawning is disabled
- Catalog reflects user's configured models (not hardcoded)

---

### Task 8 — Add orchestration config fields

**Files:**

- `src/config/types.agent-defaults.ts` — subagents config (L268-L286)
- `src/config/zod-schema.ts` — Zod validation

**Changes:**

1. Add to the inline subagents config type:
   - `defaultTier?: ModelTier` — default tier when agent doesn't specify (default: `"standard"`)
   - `budgetPerTask?: number` — max estimated cost (USD) per spawned subtask
   - `costCeiling?: number` — total cost ceiling across all sub-agents per parent run
2. Add matching Zod validators in the schema
3. When `defaultTier` is set and agent spawns without `model` or `tier`, use `defaultTier` as the tier (insert into resolution waterfall in Task 6, between step 2 and 3)

**Acceptance criteria:**

- Config validates with new optional fields
- `openclaw config set agents.defaults.subagents.defaultTier standard` works
- JSON Schema regeneration passes

---

### Task 9 — Add pre-run cost estimation and budget enforcement

**Files:**

- New file: `src/agents/cost-estimation.ts` (~100 LOC)
- `src/agents/subagent-spawn.ts` — before spawn execution

**Changes:**

1. New function:

   ```
   estimateRunCost(params: {
     modelId: string;
     estimatedInputTokens: number;
     cfg: OpenClawConfig;
   }): { estimatedCostUsd: number } | undefined
   ```

   - Look up model cost from catalog/config
   - Estimate: `(inputTokens * cost.input + maxOutputTokens * cost.output) / 1_000_000`
   - Return `undefined` if cost data unavailable

2. Token estimation helper:

   ```
   estimateTokenCount(text: string): number
   ```

   - Rough heuristic: `text.length / 3.5` (conservative chars-to-tokens ratio)

3. In `spawnSubagentDirect()`, after model resolution but before the gateway RPC call:
   - If `budgetPerTask` is configured, call `estimateRunCost()`
   - If estimated cost > budget, return tool error: `"Estimated cost ($X.XX) exceeds budget ($Y.YY) for this sub-agent task. Use a cheaper tier or increase budgetPerTask."`

4. Track cumulative cost per parent run (in-memory counter on the subagent registry entry) for `costCeiling` enforcement

**Acceptance criteria:**

- Cost estimation returns reasonable numbers for known models
- Spawn rejected when over budget (with helpful error message)
- Spawn allowed when under budget or no budget configured
- Unit tests for estimation and enforcement

---

### Task 10 — Add `before_subagent_model_resolve` plugin hook

**Files:**

- `src/plugins/hooks.ts` — hook definitions
- `src/plugins/types.ts` — `OpenClawPluginApi` registration
- `src/agents/subagent-spawn.ts` — fire the hook

**Changes:**

1. Define new modifying hook `before_subagent_model_resolve`:
   - Input: `{ task: string; agentId: string; tier?: ModelTier; requiredCapabilities?: string[]; defaultModel: string }`
   - Output: `{ modelOverride?: string; tierOverride?: ModelTier }` — plugins can reroute
2. Register in `OpenClawPluginApi.registerHook()` type
3. Fire in `spawnSubagentDirect()` between depth check and model resolution (before L380)
4. Hook result takes priority: `modelOverride` → `tierOverride` → existing resolution

**Acceptance criteria:**

- Plugin can intercept and override model selection at spawn time
- Hook fires for every `sessions_spawn` call
- Hook is optional — no-op if no plugin registers

---

### Task 11 — Update Zod validation and JSON Schema

**Files:**

- `src/config/zod-schema.ts`
- `src/config/schema.ts`

**Changes:**

1. Add Zod validators for all new config fields from Tasks 1 and 8:
   - `tier` enum validation
   - `capabilities` string array validation
   - `defaultTier`, `budgetPerTask` (positive number), `costCeiling` (positive number)
2. Regenerate JSON Schema
3. Validate against existing test configs

**Acceptance criteria:**

- Invalid tier values rejected by config validation
- Negative budget values rejected
- JSON Schema output updated

---

### Task 12 — Tests

**Files:**

- `src/agents/model-router.test.ts` (new)
- `src/agents/model-tiers.test.ts` (new)
- `src/agents/cost-estimation.test.ts` (new)
- `src/agents/model-selection.test.ts` (update existing)
- `src/agents/tools/sessions-spawn-tool.test.ts` (update existing)

**Test cases:**

1. **Model router:**
   - 3 models in "fast" tier → cheapest selected
   - Capability filter: require "vision" → text-only excluded
   - No matching models → returns undefined (fallback to default)
   - Empty catalog → graceful fallback
   - User config tier overrides preset tier
2. **Tier presets:**
   - Known model IDs map to expected tiers
   - Unknown model returns undefined
   - Substring matching works across providers
3. **Cost estimation:**
   - Known model → reasonable cost estimate
   - Unknown model → undefined
   - Budget exceeded → rejection
   - Budget not set → always allows
4. **Model selection integration:**
   - `tier` param → tier resolution path taken
   - `model` param → model override path taken (existing behavior)
   - Neither → config waterfall (existing behavior)
   - Both → error
5. **Spawn tool schema:**
   - Valid `tier` values accepted
   - Invalid `tier` values rejected
   - `requiredCapabilities` array accepted

---

## Verification Checklist

- [ ] `pnpm build` — no type errors
- [ ] `pnpm test` — all tests pass (existing + new)
- [ ] `pnpm check` — lint/format clean
- [ ] Manual: configure 2 models with different costs in "fast" tier → spawn picks cheaper one
- [ ] Manual: set `budgetPerTask: 0.001` → spawn with premium model rejected
- [ ] Manual: agent system prompt shows model catalog table
- [ ] Manual: `sessions_spawn(tier="fast")` routes to haiku-class model
- [ ] Manual: `sessions_spawn(model="anthropic/claude-opus-4-6")` still works unchanged

---

## Dependency Order

```
Task 1 (types) ──► Task 2 (catalog) ──► Task 3 (presets) ──► Task 5 (router)
                                                                  │
Task 4 (spawn schema) ─────────────────────────────────────► Task 6 (integration)
                                                                  │
                                                            Task 7 (prompt)
                                                            Task 8 (config)
                                                            Task 9 (cost/budget)
                                                            Task 10 (hook)
                                                                  │
                                                            Task 11 (validation)
                                                            Task 12 (tests)
```

Tasks 1-3 can be done in sequence first. Task 4 is independent and can parallel Tasks 2-3. Tasks 5-10 depend on earlier tasks. Tasks 11-12 are finalization.

---

## Key Decisions

- **Hybrid orchestration**: Programmatic router picks cheapest model; agent drives decomposition (not system-level auto-decomposition)
- **Config-driven tiers**: Users define tiers in `openclaw.json`; built-in presets for major models
- **3-tier system** (`fast`/`standard`/`premium`): Simple enough for LLMs to reason about
- **Backwards compatible**: `tier` is additive to existing `model` param; no existing config/behavior breaks
- **All channels**: Hooks into core `sessions_spawn` → works everywhere automatically
- **Cost data source**: `ModelDefinitionConfig.cost` (already exists) + user config overrides
