import { closePool, withTransaction } from "./lib/db.ts";
import { hashPassword } from "./lib/auth.ts";
import { nextStaffId, temporaryPassword } from "./lib/ids.ts";

/**
 * Development seed.
 *
 * Creates a pharmacy, a Chief Pharmacist with a known password, one account per
 * remaining role (each on a temporary password, exactly as a real provisioning
 * would leave them), and a demo shelf with two already-expired batches.
 *
 * Refuses to run against a database that already has users, so it can't be
 * pointed at production by accident.
 */

const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Apotheca#2026";

interface SeedBatch {
  name: string;
  brand: string;
  form: string;
  strength: string;
  batchNo: string;
  days: number;
  qty: number;
  mrp: number;
  cost: number;
  gst: number;
  mfr: string;
  rack: string;
  reorder: number;
  sch: string;
}

const SHELF: SeedBatch[] = [
  { name: "Paracetamol", brand: "Dolo", form: "Tablet", strength: "650 mg", batchNo: "DL2419", days: 400, qty: 420, mrp: 2.1, cost: 1.62, gst: 12, mfr: "Micro Labs", rack: "A-01", reorder: 100, sch: "OTC" },
  { name: "Paracetamol", brand: "Dolo", form: "Tablet", strength: "650 mg", batchNo: "DL2288", days: 48, qty: 60, mrp: 2.1, cost: 1.62, gst: 12, mfr: "Micro Labs", rack: "A-01", reorder: 100, sch: "OTC" },
  { name: "Paracetamol", brand: "Calpol", form: "Syrup", strength: "125 mg/5 ml", batchNo: "CP1180", days: 150, qty: 36, mrp: 48, cost: 36, gst: 12, mfr: "GSK", rack: "A-02", reorder: 12, sch: "OTC" },
  { name: "Amoxicillin + Clavulanic Acid", brand: "Augmentin", form: "Tablet", strength: "625 mg", batchNo: "AG7741", days: 240, qty: 180, mrp: 21.5, cost: 16.8, gst: 12, mfr: "GSK", rack: "B-03", reorder: 60, sch: "H" },
  { name: "Azithromycin", brand: "Azithral", form: "Tablet", strength: "500 mg", batchNo: "AZ5520", days: -6, qty: 45, mrp: 28.4, cost: 20.1, gst: 12, mfr: "Alembic", rack: "B-02", reorder: 30, sch: "H" },
  { name: "Pantoprazole", brand: "Pan", form: "Tablet", strength: "40 mg", batchNo: "PN9032", days: 310, qty: 260, mrp: 8.4, cost: 5.9, gst: 12, mfr: "Alkem", rack: "B-01", reorder: 80, sch: "H" },
  { name: "Cetirizine", brand: "Cetzine", form: "Tablet", strength: "10 mg", batchNo: "CZ2201", days: 22, qty: 96, mrp: 1.9, cost: 1.2, gst: 12, mfr: "Dr. Reddy's", rack: "C-04", reorder: 100, sch: "OTC" },
  { name: "Metformin", brand: "Glycomet", form: "Tablet", strength: "500 mg", batchNo: "GM5510", days: 500, qty: 340, mrp: 3.2, cost: 2.1, gst: 12, mfr: "USV", rack: "C-01", reorder: 120, sch: "H" },
  { name: "Amlodipine", brand: "Amlong", form: "Tablet", strength: "5 mg", batchNo: "AM3390", days: 75, qty: 210, mrp: 3.8, cost: 2.4, gst: 12, mfr: "Micro Labs", rack: "C-02", reorder: 100, sch: "H" },
  { name: "Ondansetron", brand: "Emeset", form: "Injection", strength: "2 mg/ml", batchNo: "EM4412", days: -12, qty: 24, mrp: 16, cost: 11, gst: 12, mfr: "Cipla", rack: "D-01", reorder: 20, sch: "H" },
  { name: "Salbutamol", brand: "Asthalin", form: "Inhaler", strength: "100 mcg/dose", batchNo: "AS8890", days: 260, qty: 18, mrp: 128, cost: 94, gst: 5, mfr: "Cipla", rack: "D-04", reorder: 10, sch: "H" },
  { name: "ORS + Zinc", brand: "Electral", form: "Sachet", strength: "21.8 g", batchNo: "EL3321", days: 600, qty: 140, mrp: 22, cost: 15.5, gst: 5, mfr: "FDC", rack: "E-01", reorder: 50, sch: "OTC" },
  { name: "Normal Saline (Sodium Chloride)", brand: "NS IV", form: "IV Fluid", strength: "0.9% w/v — 500 ml", batchNo: "NS6602", days: 190, qty: 8, mrp: 42, cost: 29, gst: 12, mfr: "Baxter", rack: "F-01", reorder: 24, sch: "H" },
];

const STAFF = [
  { name: "R. Krishnan", email: "krishnan@hospital.in", role: "Pharmacist" as const, department: "Pharmacy" },
  { name: "Dr. Meera Iyer", email: "meera@hospital.in", role: "Doctor" as const, department: "General Medicine" },
  { name: "Rakesh Patil", email: "rakesh@hospital.in", role: "Pharmacy Staff" as const, department: "Pharmacy" },
  { name: "Sister Priya Nair", email: "priya@hospital.in", role: "Nurse" as const, department: "Ward 3" },
];

async function main(): Promise<void> {
  const issued: Array<{ name: string; role: string; staffId: string; password: string }> = [];

  await withTransaction(async (client) => {
    const { rows: existing } = await client.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM users",
    );
    if ((existing[0]?.count ?? 0) > 0) {
      throw new Error(
        "This database already has accounts. Refusing to seed — drop the volume first if you meant to reset.",
      );
    }

    const { rows: pharmacyRows } = await client.query<{ id: string }>(
      `INSERT INTO pharmacies (name, gstin, licence_no, address)
       VALUES ('City Hospital Pharmacy', '27AAAAA0000A1Z5', 'MH-PH-2019-4417',
               'Ward 2, City Hospital, Pune')
       RETURNING id`,
    );
    const pharmacyId = pharmacyRows[0]!.id;

    // --- administrator, with a known password so you can actually sign in ---
    const adminStaffId = await nextStaffId(client, "Chief Pharmacist");
    const [adminHash, answerHash] = await Promise.all([
      hashPassword(ADMIN_PASSWORD),
      hashPassword("pune"),
    ]);

    const { rows: adminRows } = await client.query<{ id: string }>(
      `INSERT INTO users
         (pharmacy_id, staff_id, email, name, phone, department, role,
          password_hash, security_question, security_answer_hash,
          must_change_password, active)
       VALUES ($1,$2,'sharma@hospital.in','Dr. A. Sharma','+91 98200 11223','Pharmacy',
               'Chief Pharmacist',$3,'Which city was your first posting in?',$4,FALSE,TRUE)
       RETURNING id`,
      [pharmacyId, adminStaffId, adminHash, answerHash],
    );
    const adminId = adminRows[0]!.id;
    issued.push({
      name: "Dr. A. Sharma",
      role: "Chief Pharmacist",
      staffId: adminStaffId,
      password: ADMIN_PASSWORD,
    });

    // --- everyone else, provisioned exactly as the admin UI would ---
    for (const person of STAFF) {
      const staffId = await nextStaffId(client, person.role);
      const plain = temporaryPassword();
      const hash = await hashPassword(plain);

      await client.query(
        `INSERT INTO users
           (pharmacy_id, staff_id, email, name, department, role,
            password_hash, must_change_password, active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,TRUE,$8)`,
        [pharmacyId, staffId, person.email, person.name, person.department, person.role, hash, adminId],
      );

      issued.push({ name: person.name, role: person.role, staffId, password: plain });
    }

    // --- the shelf ---
    for (const b of SHELF) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO batches
           (pharmacy_id,name,brand,form,strength,batch_no,expiry,qty,mrp,cost,gst,
            mfr,rack,reorder_level,schedule,added_by)
         -- $7::int is required: with a bind parameter Postgres can't infer
         -- which "date + ?" operator is meant, and errors as ambiguous.
         VALUES ($1,$2,$3,$4,$5,$6, CURRENT_DATE + $7::int, $8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [
          pharmacyId, b.name, b.brand, b.form, b.strength, b.batchNo, b.days,
          b.qty, b.mrp, b.cost, b.gst, b.mfr, b.rack, b.reorder, b.sch, adminId,
        ],
      );
      await client.query(
        `INSERT INTO stock_movements
           (pharmacy_id, batch_id, kind, delta, qty_after, note, by_user)
         VALUES ($1,$2,'receive',$3,$3,'Seed data',$4)`,
        [pharmacyId, rows[0]!.id, b.qty, adminId],
      );
    }

    await client.query(
      `INSERT INTO audit_log (pharmacy_id, actor_id, actor_name, action, summary)
       VALUES ($1,$2,'Dr. A. Sharma','data.import',$3)`,
      [pharmacyId, adminId, `Seeded ${SHELF.length} batches and ${STAFF.length + 1} accounts`],
    );
  });

  console.log("\nSeeded City Hospital Pharmacy.\n");
  console.log("  Sign in with the Staff ID or the email address:\n");
  for (const person of issued) {
    console.log(
      `  ${person.staffId.padEnd(13)} ${person.password.padEnd(14)} ${person.role.padEnd(18)} ${person.name}`,
    );
  }
  console.log(
    "\n  Everyone except the administrator must change their password on first sign-in.\n",
  );

  await closePool();
}

main().catch(async (error) => {
  console.error("\nSeed failed:", error instanceof Error ? error.message : error);
  await closePool();
  process.exit(1);
});
