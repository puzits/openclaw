import { describe, expect, it } from "vitest";
import { buildCopilotModelDefinition, getDefaultCopilotModelIds } from "./github-copilot-models.js";

describe("github-copilot-models", () => {
  describe("getDefaultCopilotModelIds", () => {
    it("includes claude-sonnet-4.6", () => {
      expect(getDefaultCopilotModelIds()).toContain("claude-sonnet-4.6");
    });

    it("includes claude-sonnet-4.5", () => {
      expect(getDefaultCopilotModelIds()).toContain("claude-sonnet-4.5");
    });

    it("includes claude-opus-4.5", () => {
      expect(getDefaultCopilotModelIds()).toContain("claude-opus-4.5");
    });

    it("includes claude-haiku-4.5", () => {
      expect(getDefaultCopilotModelIds()).toContain("claude-haiku-4.5");
    });

    it("includes o3", () => {
      expect(getDefaultCopilotModelIds()).toContain("o3");
    });

    it("includes o4-mini", () => {
      expect(getDefaultCopilotModelIds()).toContain("o4-mini");
    });

    it("returns a mutable copy", () => {
      const a = getDefaultCopilotModelIds();
      const b = getDefaultCopilotModelIds();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe("buildCopilotModelDefinition", () => {
    it("builds a valid definition for claude-sonnet-4.6", () => {
      const def = buildCopilotModelDefinition("claude-sonnet-4.6");
      expect(def.id).toBe("claude-sonnet-4.6");
      expect(def.api).toBe("openai-responses");
    });

    it("trims whitespace from model id", () => {
      const def = buildCopilotModelDefinition("  gpt-4o  ");
      expect(def.id).toBe("gpt-4o");
    });

    it("throws on empty model id", () => {
      expect(() => buildCopilotModelDefinition("")).toThrow("Model id required");
      expect(() => buildCopilotModelDefinition("  ")).toThrow("Model id required");
    });

    it("sets reasoning: false for non-reasoning models", () => {
      for (const id of [
        "gpt-4o",
        "gpt-4.1",
        "gpt-4.1-mini",
        "claude-sonnet-4.6",
        "claude-opus-4.5",
      ]) {
        expect(buildCopilotModelDefinition(id).reasoning).toBe(false);
      }
    });

    it("sets reasoning: true for o1 series models", () => {
      expect(buildCopilotModelDefinition("o1").reasoning).toBe(true);
      expect(buildCopilotModelDefinition("o1-mini").reasoning).toBe(true);
    });

    it("sets reasoning: true for o3 series models", () => {
      expect(buildCopilotModelDefinition("o3").reasoning).toBe(true);
      expect(buildCopilotModelDefinition("o3-mini").reasoning).toBe(true);
    });

    it("sets reasoning: true for o4 series models", () => {
      expect(buildCopilotModelDefinition("o4-mini").reasoning).toBe(true);
    });
  });
});
