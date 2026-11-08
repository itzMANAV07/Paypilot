/**
 * scripts/seed-sandbox.ts
 *
 * Seeds 5-6 realistic sandbox invoices for judges and demo reviewers:
 *  - 2 unpaid active invoices (due in future)
 *  - 2 overdue invoices (backdated past due date)
 *  - 2 paid invoices (settled via recordPayment)
 *
 * IDEMPOTENT: Safe to run multiple times. Checks for existing seeded invoices
 * by a unique memo/note key before creating.
 *
 * Run with: npm run seed
 */

import "dotenv/config";
import {
  createDraftInvoice,
  sendInvoice,
  recordPayment,
  listInvoices,
  type PayPalInvoiceBody,
} from "../lib/paypal";
import { env } from "../lib/env";

interface SeedSpec {
  key: string;
  clientName: { given_name?: string; surname?: string; company_name?: string };
  itemName: string;
  itemDesc: string;
  amount: string;
  dueDaysOffset: number; // positive = future, negative = past (overdue)
  settlePayment: boolean; // if true, calls recordPayment
}

const SEED_INVOICES: SeedSpec[] = [
  {
    key: "SEED-ACME-01",
    clientName: { company_name: "Acme Enterprise Corp" },
    itemName: "Q3 Backend Architecture & Cloud Migration",
    itemDesc: "Microservices design and database sharding consultation",
    amount: "1200.00",
    dueDaysOffset: 21,
    settlePayment: false,
  },
  {
    key: "SEED-RAHUL-02",
    clientName: { given_name: "Rahul", surname: "Sharma" },
    itemName: "Brand Identity & Design System",
    itemDesc: "Logo suite, typography guide, and Figma component library",
    amount: "450.00",
    dueDaysOffset: 14,
    settlePayment: false,
  },
  {
    key: "SEED-STARLIGHT-03",
    clientName: { company_name: "Starlight Digital Media" },
    itemName: "Full-Stack Web App Development (Milestone 2)",
    itemDesc: "Next.js dashboard, API integration, and performance audit",
    amount: "2400.00",
    dueDaysOffset: -12, // 12 days overdue
    settlePayment: false,
  },
  {
    key: "SEED-APEX-04",
    clientName: { company_name: "Apex Mobile Studios" },
    itemName: "iOS & Android Mobile UX Review",
    itemDesc: "User testing report and interactive prototypes",
    amount: "850.00",
    dueDaysOffset: -25, // 25 days overdue
    settlePayment: false,
  },
  {
    key: "SEED-SARAH-05",
    clientName: { given_name: "Sarah", surname: "Connor" },
    itemName: "Technical Copywriting & Landing Page Redesign",
    itemDesc: "Conversion copy, value proposition messaging, and SEO audit",
    amount: "350.00",
    dueDaysOffset: -5,
    settlePayment: true, // Paid!
  },
  {
    key: "SEED-TECHVENTURES-06",
    clientName: { company_name: "TechVentures Global Partners" },
    itemName: "DevOps CI/CD Automation & Security Review",
    itemDesc: "Automated pipelines, secrets scanning, and Docker setup",
    amount: "3100.00",
    dueDaysOffset: 7,
    settlePayment: true, // Paid!
  },
];

async function main() {
  console.log("🌱 PayPilot Sandbox Seeder\n");

  const recipientEmail = process.env.SANDBOX_RECIPIENT_EMAIL;
  if (!recipientEmail) {
    throw new Error(
      "Missing SANDBOX_RECIPIENT_EMAIL in environment. Set it in .env to your sandbox personal account email."
    );
  }

  console.log(`Invoicer:  ${env.INVOICER_NAME} (${env.INVOICER_EMAIL})`);
  console.log(`Recipient: ${recipientEmail}`);
  console.log("Fetching existing invoices to check for duplicates…\n");

  const existing = await listInvoices({ pageSize: 50 });
  console.log(`Found ${existing.length} existing invoices in sandbox.\n`);

  const now = new Date();

  for (const spec of SEED_INVOICES) {
    const displayName =
      spec.clientName.company_name ??
      `${spec.clientName.given_name ?? ""} ${spec.clientName.surname ?? ""}`.trim();

    // Check if this seed invoice already exists by checking the memo key
    const match = existing.find(
      (inv) =>
        inv.detail?.memo?.includes(spec.key) ||
        inv.detail?.note?.includes(spec.key)
    );

    if (match) {
      console.log(
        `⏭️  [${spec.key}] Already seeded: ${displayName} ($${spec.amount}) -> ID: ${match.id} (Status: ${match.status})`
      );
      continue;
    }

    // Compute dates
    const invoiceDate = new Date(now);
    const dueDate = new Date(now);

    if (spec.dueDaysOffset < 0) {
      // Overdue: backdate invoice_date and due_date
      invoiceDate.setDate(now.getDate() + spec.dueDaysOffset - 15);
      dueDate.setDate(now.getDate() + spec.dueDaysOffset);
    } else {
      // Future
      dueDate.setDate(now.getDate() + spec.dueDaysOffset);
    }

    const invoiceDateStr = invoiceDate.toISOString().slice(0, 10);
    const dueDateStr = dueDate.toISOString().slice(0, 10);

    const body: PayPalInvoiceBody = {
      detail: {
        invoice_date: invoiceDateStr,
        currency_code: "USD",
        note: `Thank you for your business! [${spec.key}]`,
        memo: `[${spec.key}]`,
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
            name: spec.clientName,
            email_address: recipientEmail,
          },
        },
      ],
      items: [
        {
          name: spec.itemName,
          description: spec.itemDesc,
          quantity: "1",
          unit_amount: {
            currency_code: "USD",
            value: spec.amount,
          },
        },
      ],
    };

    console.log(
      `Creating invoice for ${displayName} ($${spec.amount}, due ${dueDateStr})…`
    );

    try {
      const draft = await createDraftInvoice(body);
      await sendInvoice(draft.id, {
        send_to_recipient: true,
        send_to_invoicer: false,
        subject: `Invoice from ${env.INVOICER_NAME}: ${spec.itemName}`,
      });

      if (spec.settlePayment) {
        console.log(`  Recording simulated payment for ${draft.id}…`);
        await recordPayment(draft.id, {
          method: "OTHER",
          amount: { currency_code: "USD", value: spec.amount },
          note: "Seeded client payment",
        });
        console.log(`  ✅ [${spec.key}] Created & PAID: ID ${draft.id}`);
      } else {
        const tag = spec.dueDaysOffset < 0 ? "OVERDUE" : "SENT";
        console.log(`  ✅ [${spec.key}] Created & ${tag}: ID ${draft.id}`);
      }
    } catch (err) {
      console.error(
        `  ❌ Failed to seed [${spec.key}]:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log("\n✨ Seeding process finished!");
}

main().catch((err) => {
  console.error("Seeder fatal error:", err);
  process.exit(1);
});

