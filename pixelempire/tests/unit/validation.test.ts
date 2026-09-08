import { describe, expect, it } from "vitest";
import {
  cleanText,
  normaliseXUsername,
  safeUrl,
  slugify,
  updateEmpireSchema,
} from "@/lib/validation";

describe("input validation (§23, §36)", () => {
  it("produces route-safe slugs", () => {
    expect(slugify("Aurelia's Empire!")).toBe("aurelia-s-empire");
    expect(slugify("  Hello   World  ")).toBe("hello-world");
    expect(slugify("Ünïcôde Kingdom")).toBe("unicode-kingdom");
    expect(slugify("---")).toBe("");
  });

  it("strips control characters from free text", () => {
    expect(cleanText("hel\u0000lo\u001fworld")).toBe("hel lo world");
    expect(cleanText("  spaced   out  ")).toBe("spaced out");
  });

  it("normalises X handles and rejects junk", () => {
    expect(normaliseXUsername("@pixelempire")).toBe("pixelempire");
    expect(normaliseXUsername("https://x.com/pixelempire")).toBe("pixelempire");
    expect(normaliseXUsername("https://twitter.com/pixel_empire")).toBe("pixel_empire");
    expect(normaliseXUsername("not a handle!")).toBeNull();
    expect(normaliseXUsername("waytoolongusernamehere")).toBeNull();
  });

  it("refuses non-http URL schemes", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeUrl("  javascript:alert(1)  ")).toBeNull();
    expect(safeUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(safeUrl("example.com")).toBe("https://example.com/");
  });

  it("rejects a script-scheme website through the empire schema", () => {
    expect(updateEmpireSchema.safeParse({ websiteUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(updateEmpireSchema.safeParse({ avatarUrl: "javascript:x" }).success).toBe(false);
  });

  it("rejects reserved slugs", () => {
    expect(updateEmpireSchema.safeParse({ slug: "admin" }).success).toBe(false);
    expect(updateEmpireSchema.safeParse({ slug: "api" }).success).toBe(false);
    expect(updateEmpireSchema.safeParse({ slug: "my-empire" }).success).toBe(true);
  });

  it("keeps markup as inert text rather than letting it reach an href", () => {
    // Names are stored verbatim and escaped by React on render; the dangerous
    // surface is URL attributes, and those are scheme-checked above.
    const parsed = updateEmpireSchema.parse({ name: "<script>alert(1)</script>" });
    expect(parsed.name).toBe("<script>alert(1)</script>");
  });
});
