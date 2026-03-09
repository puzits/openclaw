---
summary: "Sign in to GitHub Copilot from OpenClaw using the device flow"
read_when:
  - You want to use GitHub Copilot as a model provider
  - You need the `openclaw models auth login-github-copilot` flow
title: "GitHub Copilot"
---

# GitHub Copilot

## What is GitHub Copilot?

GitHub Copilot is GitHub's AI coding assistant. It provides access to Copilot
models for your GitHub account and plan. OpenClaw can use Copilot as a model
provider in two different ways.

## Two ways to use Copilot in OpenClaw

### 1) Built-in GitHub Copilot provider (`github-copilot`)

Use the native device-login flow to obtain a GitHub token, then exchange it for
Copilot API tokens when OpenClaw runs. This is the **default** and simplest path
because it does not require VS Code.

### 2) Copilot Proxy plugin (`copilot-proxy`)

Use the **Copilot Proxy** VS Code extension as a local bridge. OpenClaw talks to
the proxy’s `/v1` endpoint and uses the model list you configure there. Choose
this when you already run Copilot Proxy in VS Code or need to route through it.
You must enable the plugin and keep the VS Code extension running.

Use GitHub Copilot as a model provider (`github-copilot`). The login command runs
the GitHub device flow, saves an auth profile, and updates your config to use that
profile.

## CLI setup

```bash
openclaw models auth login-github-copilot
```

You'll be prompted to visit a URL and enter a one-time code. Keep the terminal
open until it completes.

### Optional flags

```bash
openclaw models auth login-github-copilot --profile-id github-copilot:work
openclaw models auth login-github-copilot --yes
```

## Set a default model

```bash
openclaw models set github-copilot/gpt-4o
```

### Config snippet

```json5
{
  agents: { defaults: { model: { primary: "github-copilot/gpt-4o" } } },
}
```

## Available models

OpenClaw registers the following models for the `github-copilot` provider by
default. Availability depends on your Copilot plan; if a model is rejected,
try another one from the list or remove it from your config.

| Model ID            | Family           | Notes                                                     |
| ------------------- | ---------------- | --------------------------------------------------------- |
| `claude-opus-4.5`   | Anthropic Claude | Most capable Claude; best for complex, long-horizon tasks |
| `claude-sonnet-4.6` | Anthropic Claude | Balanced capability and speed                             |
| `claude-sonnet-4.5` | Anthropic Claude | Balanced capability and speed                             |
| `claude-haiku-4.5`  | Anthropic Claude | Fast and lightweight                                      |
| `gpt-4o`            | OpenAI GPT       | General-purpose multimodal                                |
| `gpt-4.1`           | OpenAI GPT       | Latest GPT-4.1                                            |
| `gpt-4.1-mini`      | OpenAI GPT       | Efficient GPT-4.1 variant                                 |
| `gpt-4.1-nano`      | OpenAI GPT       | Smallest GPT-4.1 variant                                  |
| `o4-mini`           | OpenAI reasoning | Fast reasoning model                                      |
| `o3`                | OpenAI reasoning | Advanced reasoning model                                  |
| `o3-mini`           | OpenAI reasoning | Compact reasoning model                                   |
| `o1`                | OpenAI reasoning | Original reasoning model                                  |
| `o1-mini`           | OpenAI reasoning | Compact o1 variant                                        |

Reasoning models (`o1`, `o3`, `o4` families) are automatically recognized and
have the `reasoning` flag enabled, which unlocks extended thinking features in
the agent runtime.

## Notes

- Requires an interactive TTY; run it directly in a terminal.
- Copilot model availability depends on your plan; if a model is rejected, try
  another ID (for example `github-copilot/gpt-4.1`).
- The login stores a GitHub token in the auth profile store and exchanges it for a
  Copilot API token when OpenClaw runs.
