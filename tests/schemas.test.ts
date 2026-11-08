/**
 * tests/schemas.test.ts
 *
 * Unit tests for lib/schemas.ts
 */

import { describe, it, expect } from "vitest";
import {
  InvoiceDraftSchema,
  InvoiceItemSchema,
  draftTotal,
  DEMO_AMOUNT_CAP_USD,
} from "../lib/schemas";

const VALID_DRAFT = {
  clientName: "Rahul Sharma",
  clientEmail: "rahul@example.com",
  currency: "USD" as const,
  items: [{ name: "Logo Design", quantity: 1, unitAmount: 400 }],
  dueInDays: 14,
};

describe("InvoiceItemSchema", () => {
  it("accepts a valid item", () => {
    expect(
      InvoiceItemSchema.safeParse({ name: "Design", quantity: 1, unitAmount: 400 }).success
    ).toBe(true);
  });

  it("rejects zero quantity", () => {
    expect(
      InvoiceItemSchema.safeParse({ name: "Design", quantity: 0, unitAmount: 400 }).success
    ).toBe(false);
  });

  it("rejects negative unitAmount", () => {
    expect(
      InvoiceItemSchema.safeParse({ name: "Design", quantity: 1, unitAmount: -1 }).success
    ).toBe(false);
  });

  it("rejects empty name", () => {
    expect(
      InvoiceItemSchema.safeParse({ name: "", quantity: 1, unitAmount: 100 }).success
    ).toBe(false);
  });
});

describe("InvoiceDraftSchema", () => {
  it("accepts a fully valid draft", () => {
    const result = InvoiceDraftSchema.safeParse(VALID_DRAFT);
    expect(result.success).toBe(true);
  });

  it("rejects missing clientName", () => {
    const result = InvoiceDraftSchema.safeParse({ ...VALID_DRAFT, clientName: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = InvoiceDraftSchema.safeParse({
      ...VALID_DRAFT,
      clientEmail: "not-an-email",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("email");
  });

  it("rejects non-USD currency", () => {
    const result = InvoiceDraftSchema.safeParse({ ...VALID_DRAFT, currency: "INR" });
    expect(result.success).toBe(false);
  });

  it("rejects empty items array", () => {
    const result = InvoiceDraftSchema.safeParse({ ...VALID_DRAFT, items: [] });
    expect(result.success).toBe(false);
  });

  it("rejects dueInDays > 90", () => {
    const result = InvoiceDraftSchema.safeParse({ ...VALID_DRAFT, dueInDays: 91 });
    expect(result.success).toBe(false);
  });

  it("rejects dueInDays < 0", () => {
    const result = InvoiceDraftSchema.safeParse({ ...VALID_DRAFT, dueInDays: -1 });
    expect(result.success).toBe(false);
  });

  it("accepts dueInDays = 0 (due on receipt)", () => {
    const result = InvoiceDraftSchema.safeParse({ ...VALID_DRAFT, dueInDays: 0 });
    expect(result.success).toBe(true);
  });

  it("accepts an optional note", () => {
    const result = InvoiceDraftSchema.safeParse({ ...VALID_DRAFT, note: "Thank you!" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.note).toBe("Thank you!");
  });

  it("accepts multiple items", () => {
    const result = InvoiceDraftSchema.safeParse({
      ...VALID_DRAFT,
      items: [
        { name: "Design", quantity: 1, unitAmount: 300 },
        { name: "Revisions", quantity: 2, unitAmount: 50 },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("draftTotal", () => {
  it("computes single-item total correctly", () => {
    expect(draftTotal(VALID_DRAFT)).toBe(400);
  });

  it("sums multiple items correctly", () => {
    const draft = {
      ...VALID_DRAFT,
      items: [
        { name: "A", quantity: 2, unitAmount: 100 },
        { name: "B", quantity: 3, unitAmount: 50 },
      ],
    };
    expect(draftTotal(draft)).toBe(350);
  });

  it("returns 0 for empty items (should not reach production due to schema)", () => {
    // Cast to bypass TS — testing runtime guard
    const draft = { ...VALID_DRAFT, items: [] as typeof VALID_DRAFT.items };
    expect(draftTotal(draft)).toBe(0);
  });
});

describe("DEMO_AMOUNT_CAP_USD", () => {
  it("is set to 5000", () => {
    expect(DEMO_AMOUNT_CAP_USD).toBe(5_000);
  });

  it("flags a draft that exceeds the cap", () => {
    const bigDraft = {
      ...VALID_DRAFT,
      items: [{ name: "Enterprise contract", quantity: 1, unitAmount: 6000 }],
    };
    expect(draftTotal(bigDraft)).toBeGreaterThan(DEMO_AMOUNT_CAP_USD);
  });
});
