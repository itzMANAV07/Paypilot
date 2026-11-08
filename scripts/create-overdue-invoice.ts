/**
 * scripts/create-overdue-invoice.ts
 *
 * Creates and sends a sandbox invoice with past invoice_date and due_date
 * to test overdue invoice detection and sorting in PayPilot.
 *
 * Run with: npm run overdue
 */

import "dotenv/config";
import {
  createDraftInvoice,
  sendInvoice,
  getInvoice,
  PayPalError,
} from "../lib/paypal";
import { env } from "../lib/env";

async function main() {
  console.log("🚀 Creating an overdue invoice in PayPal sandbox…\n");

  const recipientEmail = process.env.SANDBOX_RECIPIENT_EMAIL;
  if (!recipientEmail) {
    throw new Error(
      "Set SANDBOX_RECIPIENT_EMAIL in your .env to the sandbox Personal account email."
    );
  }

  // Calculate past dates:
  // invoice_date: 30 days ago
  // due_date: 15 days ago
  const now = new Date();

  const invoiceDate = new Date(now);
  invoiceDate.setDate(now.getDate() - 30);
  const invoiceDateStr = invoiceDate.toISOString().slice(0, 10);

  const dueDate = new Date(now);
  dueDate.setDate(now.getDate() - 15);
  const dueDateStr = dueDate.toISOString().slice(0, 10);

  console.log(`Setting invoice_date: ${invoiceDateStr} (30 days ago)`);
  console.log(`Setting due_date:     ${dueDateStr} (15 days ago)`);
  console.log(`Recipient:            ${recipientEmail}`);

  try {
    console.log("\n📄 Creating draft invoice with past dates…");
    const draft = await createDraftInvoice({
      detail: {
        invoice_date: invoiceDateStr,
        currency_code: "USD",
        note: "Overdue demo invoice created for PayPilot testing.",
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
            name: {
              given_name: "Late",
              surname: "Payer",
              company_name: "Acme Late Corp",
            },
            email_address: recipientEmail,
          },
        },
      ],
      items: [
        {
          name: "Consulting Services (Past Due Demo)",
          description: "Overdue test item for AI overdue detection",
          quantity: "1",
          unit_amount: { currency_code: "USD", value: "750.00" },
        },
      ],
    });

    console.log(`✅ Draft created — ID: ${draft.id} (Status: ${draft.status})`);

    console.log("\n📨 Sending invoice to recipient…");
    await sendInvoice(draft.id, {
      send_to_recipient: true,
      send_to_invoicer: false,
      subject: "Overdue Notice: Invoice from PayPilot",
      note: "This invoice was due 15 days ago. Please remit payment immediately.",
    });
    console.log("✅ Invoice sent successfully!");

    const fetched = await getInvoice(draft.id);
    console.log(`\n🎉 Overdue invoice ready in PayPal sandbox:`);
    console.log(`   ID:           ${fetched.id}`);
    console.log(`   Number:       ${fetched.detail?.invoice_number ?? fetched.id}`);
    console.log(`   Status:       ${fetched.status}`);
    console.log(`   Invoice Date: ${fetched.detail?.invoice_date}`);
    console.log(`   Due Date:     ${fetched.detail?.payment_term?.due_date}`);
    console.log(`   Amount:       $${fetched.amount?.value ?? "750.00"}`);
    console.log("\nThis invoice should now appear as Overdue in PayPilot!");
  } catch (err) {
    if (err instanceof PayPalError) {
      console.error("\n❌ PayPal API rejected the past dates request!");
      console.error(`Status code: ${err.statusCode}`);
      console.error(`Error code:  ${err.errorCode}`);
      console.error(`Details:     ${err.details}`);
      console.log("\n💡 Proposed Fallback:");
      console.log(
        "If PayPal validates due_date >= current_date, we can either set due_date to today (due on receipt) or use our ledger's client-side date mock/offset for demonstration."
      );
    } else {
      console.error("\n❌ Unexpected error:", err);
    }
    process.exit(1);
  }
}

main();
