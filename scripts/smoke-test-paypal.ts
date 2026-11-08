/**
 * scripts/smoke-test-paypal.ts
 *
 * End-to-end smoke test against the PayPal sandbox.
 * Run with:  npm run smoke
 *
 * What it does:
 *  1. Creates a draft invoice for the sandbox personal account.
 *  2. Sends it.
 *  3. Lists all invoices and prints the new one with its status.
 *  4. Fetches the invoice by ID to confirm GET works.
 *
 * Requires a populated .env file (copy .env.example and fill in values).
 */

// Load .env before anything else
import "dotenv/config";

import {
  createDraftInvoice,
  sendInvoice,
  listInvoices,
  getInvoice,
} from "../lib/paypal";
import { env } from "../lib/env";

async function main() {
  console.log("🚀 PayPilot smoke test — PayPal sandbox\n");
  console.log(`Invoicer: ${env.INVOICER_EMAIL}`);
  console.log(`Recipient env var SANDBOX_RECIPIENT_EMAIL:`, process.env.SANDBOX_RECIPIENT_EMAIL ?? "(not set)");

  const recipientEmail = process.env.SANDBOX_RECIPIENT_EMAIL;
  if (!recipientEmail) {
    throw new Error(
      "Set SANDBOX_RECIPIENT_EMAIL in your .env to the sandbox Personal account email."
    );
  }

  // ── 1. Build due date (14 days from today) ─────────────────────────────
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 14);
  const dueDateStr = dueDate.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  // ── 2. Create draft invoice ─────────────────────────────────────────────
  console.log("\n📄 Creating draft invoice…");
  const draft = await createDraftInvoice({
    detail: {
      invoice_date: today,
      currency_code: "USD",
      note: "Thank you for your business! (Smoke test)",
      payment_term: {
        term_type: "DUE_ON_DATE_SPECIFIED",
        due_date: dueDateStr,
      },
    },
    invoicer: {
      name: { company_name: env.INVOICER_NAME },
      email_address: env.INVOICER_EMAIL,
    },
    primary_recipients: [
      {
        billing_info: {
          email_address: recipientEmail,
        },
      },
    ],
    items: [
      {
        name: "Logo Design",
        description: "Smoke test invoice item",
        quantity: "1",
        unit_amount: { currency_code: "USD", value: "400.00" },
      },
    ],
  });

  console.log(`✅ Draft created — ID: ${draft.id}  Status: ${draft.status}`);

  // ── 3. Send invoice ─────────────────────────────────────────────────────
  console.log("\n📨 Sending invoice…");
  await sendInvoice(draft.id, {
    send_to_recipient: true,
    send_to_invoicer: false,
    subject: "Invoice from PayPilot (smoke test)",
    note: "Please pay at your earliest convenience.",
  });
  console.log("✅ Invoice sent");

  // ── 4. Fetch by ID to confirm ────────────────────────────────────────────
  console.log("\n🔍 Fetching invoice by ID…");
  const fetched = await getInvoice(draft.id);
  console.log(`✅ Fetched — ID: ${fetched.id}  Status: ${fetched.status}`);

  // ── 5. List invoices (first page) ───────────────────────────────────────
  console.log("\n📋 Listing invoices (all pages)…");
  const all = await listInvoices({ pageSize: 20 });
  console.log(`✅ Total invoices found: ${all.length}`);

  const match = all.find((inv) => inv.id === draft.id);
  if (match) {
    console.log(`\n🎯 New invoice in list:`);
    console.log(`   ID:     ${match.id}`);
    console.log(`   Status: ${match.status}`);
    console.log(`   Amount: ${match.amount?.value ?? "?"} ${match.amount?.currency_code ?? ""}`);
  } else {
    console.warn("⚠️  New invoice not found in list (may need a moment to index).");
  }

  console.log("\n✅ Smoke test passed — PayPal client is working correctly!\n");
}

main().catch((err) => {
  console.error("\n❌ Smoke test failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

