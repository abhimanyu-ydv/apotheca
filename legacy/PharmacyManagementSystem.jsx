import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Pill,
  Search,
  Plus,
  Trash2,
  LogOut,
  LayoutGrid,
  Boxes,
  Receipt,
  CalendarClock,
  Users,
  ShieldCheck,
  KeyRound,
  Printer,
  X,
  AlertTriangle,
  CheckCircle2,
  Package,
  Download,
  RotateCcw,
  ChevronRight,
  Loader2,
  Send,
  User,
  FileText,
} from "lucide-react";

/* ============================================================
   STORAGE LAYER  —  acts as the database
   ============================================================ */

const K = {
  users: "rx:users",
  session: "rx:session",
  stock: "rx:stock",
  bills: "rx:bills",
  patients: "rx:patients",
  prescriptions: "rx:prescriptions",
};

/* ============================================================
   ROLE-BASED ACCESS CONTROL
   ============================================================ */
const ROLES = {
  "Chief Pharmacist": {
    label: "Chief Pharmacist (Admin)",
    level: 5,
    access: {
      dashboard: true,
      addStock: true,
      inventory: true,
      billing: true,
      bills: true,
      expiry: true,
      staff: true,
      prescriptions: true,
      settings: true,
    },
  },
  Pharmacist: {
    label: "Pharmacist",
    level: 4,
    access: {
      dashboard: true,
      addStock: true,
      inventory: true,
      billing: true,
      bills: true,
      expiry: true,
      staff: false,
      prescriptions: true,
      settings: false,
    },
  },
  "Pharmacy Staff": {
    label: "Pharmacy Staff",
    level: 2,
    access: {
      dashboard: true,
      addStock: false,
      inventory: true,
      billing: true,
      bills: true,
      expiry: false,
      staff: false,
      prescriptions: false,
      settings: false,
    },
  },
  Doctor: {
    label: "Doctor",
    level: 3,
    access: {
      dashboard: false,
      addStock: false,
      inventory: false,
      billing: false,
      bills: false,
      expiry: false,
      staff: false,
      prescriptions: true,
      settings: false,
    },
  },
  Nurse: {
    label: "Nurse",
    level: 1,
    access: {
      dashboard: true,
      addStock: false,
      inventory: false,
      billing: false,
      bills: true,
      expiry: false,
      staff: false,
      prescriptions: false,
      settings: false,
    },
  },
};

async function dbGet(key, fallback) {
  try {
    const r = await window.storage.get(key);
    if (!r || r.value === undefined || r.value === null) return fallback;
    return typeof r.value === "string" ? JSON.parse(r.value) : r.value;
  } catch (e) {
    return fallback;
  }
}
async function dbSet(key, value) {
  try {
    await window.storage.set(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}
async function dbDel(key) {
  try {
    await window.storage.delete(key);
  } catch (e) {
    /* key may not exist */
  }
}

/* ---------- password hashing (SHA-256 + per-user salt) ---------- */
function randSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function hash(text, salt) {
  const buf = new TextEncoder().encode(`${salt}::${text}`);
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ---------- patient & prescription ID generation ---------- */
function genPatientId(patients) {
  let id;
  do {
    const num = Math.floor(Math.random() * 99999)
      .toString()
      .padStart(5, "0");
    id = `PAT-${num}`;
  } while (patients.some((p) => p.id === id));
  return id;
}

function genPrescriptionId(prescriptions) {
  let id;
  do {
    const num = Math.floor(Math.random() * 99999)
      .toString()
      .padStart(5, "0");
    id = `RX-${new Date().getFullYear()}-${num}`;
  } while (prescriptions.some((p) => p.id === id));
  return id;
}

/* ---------- role-specific ID generation ---------- */
function genRoleId(role, users) {
  const prefixes = {
    "Chief Pharmacist": "ADMIN",
    Pharmacist: "PHARM",
    "Pharmacy Staff": "STAFF",
    Doctor: "DOC",
    Nurse: "NURSE",
  };
  const prefix = prefixes[role] || "USR";
  let id;
  do {
    const num = Math.floor(Math.random() * 99999)
      .toString()
      .padStart(5, "0");
    id = `${prefix}-${num}`;
  } while (users.some((u) => u.roleId === id));
  return id;
}

/* ============================================================
   DRUG MASTER CATALOG  —  powers the type-ahead suggestions
   ============================================================ */

const CATALOG = [
  {
    g: "Paracetamol",
    brands: ["Dolo", "Crocin", "Calpol"],
    cls: "Analgesic / Antipyretic",
    sch: "OTC",
    forms: [
      { form: "Tablet", strengths: ["500 mg", "650 mg"] },
      { form: "Syrup", strengths: ["125 mg/5 ml", "250 mg/5 ml"] },
      { form: "Injection", strengths: ["150 mg/ml", "1000 mg/100 ml"] },
    ],
  },
  {
    g: "Amoxicillin + Clavulanic Acid",
    brands: ["Augmentin", "Clavam", "Moxikind-CV"],
    cls: "Antibiotic (Penicillin)",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["625 mg", "1000 mg"] },
      { form: "Syrup", strengths: ["228.5 mg/5 ml", "457 mg/5 ml"] },
      { form: "Injection", strengths: ["1.2 g"] },
    ],
  },
  {
    g: "Azithromycin",
    brands: ["Azithral", "Zithromax", "Azee"],
    cls: "Antibiotic (Macrolide)",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["250 mg", "500 mg"] },
      { form: "Syrup", strengths: ["100 mg/5 ml", "200 mg/5 ml"] },
    ],
  },
  {
    g: "Pantoprazole",
    brands: ["Pan", "Pantocid", "Pantop"],
    cls: "Proton Pump Inhibitor",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["20 mg", "40 mg"] },
      { form: "Injection", strengths: ["40 mg"] },
    ],
  },
  {
    g: "Cetirizine",
    brands: ["Cetzine", "Alerid", "Okacet"],
    cls: "Antihistamine",
    sch: "OTC",
    forms: [
      { form: "Tablet", strengths: ["5 mg", "10 mg"] },
      { form: "Syrup", strengths: ["5 mg/5 ml"] },
    ],
  },
  {
    g: "Metformin",
    brands: ["Glycomet", "Glucophage", "Obimet"],
    cls: "Antidiabetic (Biguanide)",
    sch: "H",
    forms: [{ form: "Tablet", strengths: ["500 mg", "850 mg", "1000 mg"] }],
  },
  {
    g: "Amlodipine",
    brands: ["Amlong", "Stamlo", "Amlopres"],
    cls: "Antihypertensive (CCB)",
    sch: "H",
    forms: [{ form: "Tablet", strengths: ["2.5 mg", "5 mg", "10 mg"] }],
  },
  {
    g: "Atorvastatin",
    brands: ["Atorva", "Lipitor", "Storvas"],
    cls: "Lipid-lowering (Statin)",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["10 mg", "20 mg", "40 mg", "80 mg"] },
    ],
  },
  {
    g: "Ibuprofen",
    brands: ["Brufen", "Combiflam", "Ibugesic"],
    cls: "NSAID",
    sch: "OTC",
    forms: [
      { form: "Tablet", strengths: ["200 mg", "400 mg", "600 mg"] },
      { form: "Syrup", strengths: ["100 mg/5 ml"] },
      { form: "Tube (Gel)", strengths: ["5% w/w"] },
    ],
  },
  {
    g: "Diclofenac",
    brands: ["Voveran", "Dynapar", "Volini"],
    cls: "NSAID",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["50 mg", "75 mg SR", "100 mg SR"] },
      { form: "Tube (Gel)", strengths: ["1% w/w", "1.16% w/w"] },
      { form: "Injection", strengths: ["75 mg/3 ml"] },
    ],
  },
  {
    g: "Omeprazole",
    brands: ["Omez", "Ocid", "Prilosec"],
    cls: "Proton Pump Inhibitor",
    sch: "H",
    forms: [{ form: "Capsule", strengths: ["20 mg", "40 mg"] }],
  },
  {
    g: "Montelukast + Levocetirizine",
    brands: ["Montek LC", "Montair LC"],
    cls: "Anti-asthmatic / Antihistamine",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["10 mg + 5 mg"] },
      { form: "Syrup", strengths: ["4 mg + 2.5 mg/5 ml"] },
    ],
  },
  {
    g: "Salbutamol",
    brands: ["Asthalin", "Ventorlin"],
    cls: "Bronchodilator",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["2 mg", "4 mg"] },
      { form: "Inhaler", strengths: ["100 mcg/dose"] },
      { form: "Respule", strengths: ["2.5 mg/2.5 ml"] },
    ],
  },
  {
    g: "Metronidazole",
    brands: ["Flagyl", "Metrogyl"],
    cls: "Antibiotic / Antiprotozoal",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["200 mg", "400 mg"] },
      { form: "Syrup", strengths: ["200 mg/5 ml"] },
      { form: "Tube (Gel)", strengths: ["1% w/w"] },
    ],
  },
  {
    g: "Ondansetron",
    brands: ["Emeset", "Vomikind", "Zofer"],
    cls: "Antiemetic",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["4 mg", "8 mg"] },
      { form: "Syrup", strengths: ["2 mg/5 ml"] },
      { form: "Injection", strengths: ["2 mg/ml"] },
    ],
  },
  {
    g: "Levothyroxine",
    brands: ["Thyronorm", "Eltroxin"],
    cls: "Thyroid hormone",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["25 mcg", "50 mcg", "75 mcg", "100 mcg"] },
    ],
  },
];

const FORMS = [
  "Tablet",
  "Capsule",
  "Syrup",
  "Injection",
  "Tube (Cream)",
  "Tube (Gel)",
  "Tube (Ointment)",
  "Eye/Ear Drops",
  "Inhaler",
  "Respule",
  "Sachet",
  "Solution",
  "IV Fluid",
];

const PACK_UNIT = (form) => {
  if (/Tablet|Capsule/.test(form)) return "tablets";
  if (/Syrup|Solution|Drops/.test(form)) return "bottles";
  if (/Tube/.test(form)) return "tubes";
  if (/Injection/.test(form)) return "vials";
  if (/IV Fluid/.test(form)) return "bottles";
  if (/Sachet/.test(form)) return "sachets";
  if (/Inhaler|Respule/.test(form)) return "units";
  return "units";
};

/* ============================================================
   HELPERS
   ============================================================ */
const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const today = () => new Date(new Date().toDateString());
const daysLeft = (d) => Math.round((new Date(d) - today()) / 86400000);
const money = (n) => "₹" + Number(n || 0).toFixed(2);
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

function expiryState(dateStr) {
  const d = daysLeft(dateStr);
  if (d < 0) return { key: "expired", label: "Expired", days: d };
  if (d <= 30) return { key: "critical", label: `${d} d left`, days: d };
  if (d <= 90) return { key: "warning", label: `${d} d left`, days: d };
  return { key: "ok", label: `${d} d left`, days: d };
}

function seedStock() {
  const dt = (n) =>
    new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const base = [
    [
      "Paracetamol",
      "Dolo",
      "Tablet",
      "650 mg",
      420,
      "DL2419",
      dt(400),
      2.1,
      1.62,
      12,
      "Micro Labs",
      "A-01",
      100,
    ],
    [
      "Paracetamol",
      "Calpol",
      "Syrup",
      "125 mg/5 ml",
      36,
      "CP1180",
      dt(150),
      48.0,
      36.0,
      12,
      "GSK",
      "A-02",
      12,
    ],
    [
      "Amoxicillin + Clavulanic Acid",
      "Augmentin",
      "Tablet",
      "625 mg",
      180,
      "AG7741",
      dt(240),
      21.5,
      16.8,
      12,
      "GSK",
      "B-03",
      60,
    ],
    [
      "Pantoprazole",
      "Pan",
      "Tablet",
      "40 mg",
      260,
      "PN9032",
      dt(310),
      8.4,
      5.9,
      12,
      "Alkem",
      "B-01",
      80,
    ],
    [
      "Cetirizine",
      "Cetzine",
      "Tablet",
      "10 mg",
      96,
      "CZ2201",
      dt(22),
      1.9,
      1.2,
      12,
      "Dr. Reddy's",
      "C-04",
      100,
    ],
    [
      "Metformin",
      "Glycomet",
      "Tablet",
      "500 mg",
      340,
      "GM5510",
      dt(500),
      3.2,
      2.1,
      12,
      "USV",
      "C-01",
      120,
    ],
    [
      "Amlodipine",
      "Amlong",
      "Tablet",
      "5 mg",
      210,
      "AM3390",
      dt(75),
      3.8,
      2.4,
      12,
      "Micro Labs",
      "C-02",
      100,
    ],
    [
      "Ondansetron",
      "Emeset",
      "Injection",
      "2 mg/ml",
      24,
      "EM4412",
      dt(-12),
      16.0,
      11.0,
      12,
      "Cipla",
      "D-01",
      20,
    ],
  ];
  return base.map(
    ([
      name,
      brand,
      form,
      strength,
      qty,
      batchNo,
      expiry,
      mrp,
      cost,
      gst,
      mfr,
      rack,
      reorder,
    ]) => {
      const c = CATALOG.find((x) => x.g === name);
      return {
        id: uid(),
        name,
        brand,
        form,
        strength,
        qty,
        batchNo,
        expiry,
        mrp,
        cost,
        gst,
        mfr,
        rack,
        reorder,
        cls: c ? c.cls : "",
        sch: c ? c.sch : "OTC",
        addedAt: new Date().toISOString(),
        addedBy: "System seed",
      };
    },
  );
}

/* ============================================================
   STYLES (CONDENSED)
   ============================================================ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
.rx * { box-sizing: border-box; }
.rx {
  --ink:#0F2233; --ink2:#1D3B54; --paper:#EBF1F4; --surface:#FFFFFF;
  --line:#D2DEE5; --line2:#E7EEF2; --muted:#5F7688;
  --teal:#0E7A6B; --teal-d:#0A5C51; --teal-l:#E3F2EF;
  --amber:#B26A05; --amber-l:#FDF0DC;
  --red:#A8221B; --red-l:#FBE6E4;
  font-family:'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
  color:var(--ink); background:var(--paper);
  min-height:100vh; font-size:14px; line-height:1.45;
}
.rx h1,.rx h2,.rx h3,.rx .disp { font-family:'IBM Plex Sans Condensed','IBM Plex Sans',sans-serif; letter-spacing:-0.01em; }
.rx .mono { font-family:'IBM Plex Mono', ui-monospace, monospace; font-variant-numeric:tabular-nums; }
.rx button, .rx input, .rx select, .rx textarea { font:inherit; color:inherit; }
.rx :focus-visible { outline:2px solid var(--teal); outline-offset:2px; }

.eyebrow { font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); }

.auth { display:grid; grid-template-columns:minmax(0,1.05fr) minmax(0,1fr); min-height:100vh; }
.auth-side { background:var(--ink); color:#DCE8EF; padding:44px 40px; display:flex; flex-direction:column; justify-content:space-between; position:relative; overflow:hidden; }
.auth-side::after { content:'℞'; position:absolute; right:-70px; bottom:-130px; font-size:440px; line-height:1; font-family:'IBM Plex Sans Condensed',serif; color:rgba(255,255,255,.045); pointer-events:none; }
.auth-form { background:var(--surface); padding:44px 40px; display:flex; flex-direction:column; justify-content:center; }
.auth-inner { width:100%; max-width:380px; margin:0 auto; }
@media (max-width:860px){ .auth{grid-template-columns:1fr;} .auth-side{padding:28px 22px; min-height:auto;} .auth-side::after{font-size:230px; right:-40px; bottom:-80px;} .auth-form{padding:28px 22px;} }

.strip { border:1px solid rgba(255,255,255,.18); border-left:4px solid var(--teal); padding:12px 14px; background:rgba(255,255,255,.05); }
.strip + .strip { border-top:none; }

.shell { display:grid; grid-template-columns:236px minmax(0,1fr); min-height:100vh; }
.rail { background:var(--ink); color:#C9D9E3; padding:18px 12px; display:flex; flex-direction:column; gap:2px; }
.rail-brand { padding:6px 10px 18px; display:flex; gap:10px; align-items:center; }
.nav { display:flex; align-items:center; gap:10px; padding:9px 11px; border-radius:3px; background:none; border:none; width:100%; text-align:left; cursor:pointer; color:#A9C0CE; font-size:13.5px; }
.nav:hover { background:rgba(255,255,255,.06); color:#fff; }
.nav.on { background:var(--teal); color:#fff; font-weight:600; }
.nav .cnt { margin-left:auto; font-family:'IBM Plex Mono',monospace; font-size:11px; background:rgba(255,255,255,.14); padding:1px 6px; border-radius:2px; }
.nav.on .cnt { background:rgba(0,0,0,.22); }
.main { padding:0 0 60px; min-width:0; }
.topbar { background:var(--surface); border-bottom:1px solid var(--line); padding:14px 26px; display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
.pad { padding:22px 26px; }
@media (max-width:820px){ .shell{grid-template-columns:1fr;} .rail{flex-direction:row; overflow-x:auto; padding:8px;} .rail-brand{display:none;} .nav{width:auto; white-space:nowrap;} .pad{padding:16px;} .topbar{padding:12px 16px;} }

.card { background:var(--surface); border:1px solid var(--line); border-radius:3px; }
.card-h { padding:12px 16px; border-bottom:1px solid var(--line2); display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.card-b { padding:16px; }
.grid { display:grid; gap:14px; }
.g4 { grid-template-columns:repeat(4,minmax(0,1fr)); }
.g3 { grid-template-columns:repeat(3,minmax(0,1fr)); }
.g2 { grid-template-columns:repeat(2,minmax(0,1fr)); }
@media (max-width:1000px){ .g4{grid-template-columns:repeat(2,minmax(0,1fr));} .g3{grid-template-columns:1fr;} }
@media (max-width:620px){ .g4,.g2{grid-template-columns:1fr;} }

.stat { background:var(--surface); border:1px solid var(--line); border-left:3px solid var(--teal); border-radius:3px; padding:14px 16px; }
.stat .n { font-family:'IBM Plex Sans Condensed',sans-serif; font-size:30px; font-weight:600; line-height:1.05; font-variant-numeric:tabular-nums; }

.f { display:flex; flex-direction:column; gap:5px; min-width:0; }
.f label { font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
.f input,.f select,.f textarea { border:1px solid var(--line); border-radius:2px; padding:9px 10px; background:#FCFDFE; width:100%; }
.f input:focus,.f select:focus { border-color:var(--teal); background:#fff; }
.f .hint { font-size:11.5px; color:var(--muted); }

.btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; padding:9px 15px; border-radius:2px; border:1px solid var(--line); background:var(--surface); cursor:pointer; font-weight:500; }
.btn:hover { border-color:var(--ink2); }
.btn.p { background:var(--teal); border-color:var(--teal); color:#fff; }
.btn.p:hover { background:var(--teal-d); border-color:var(--teal-d); }
.btn.d { background:var(--red); border-color:var(--red); color:#fff; }
.btn.g { background:none; border-color:transparent; color:var(--muted); }
.btn.g:hover { color:var(--ink); background:var(--line2); }
.btn:disabled { opacity:.45; cursor:not-allowed; }
.btn.sm { padding:5px 10px; font-size:12.5px; }
.btn.full { width:100%; }
.link { background:none; border:none; color:var(--teal); cursor:pointer; padding:0; font-weight:500; }
.link:hover { text-decoration:underline; }

.tbl { width:100%; border-collapse:collapse; }
.tbl th { text-align:left; font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); font-weight:500; padding:9px 12px; border-bottom:1px solid var(--line); }
.tbl td { padding:11px 12px; border-bottom:1px solid var(--line2); vertical-align:middle; }
.tbl tr:last-child td { border-bottom:none; }
.tbl tbody tr:hover { background:#F7FAFB; }
.scroll { overflow-x:auto; }

.tag { display:inline-flex; align-items:center; gap:5px; font-family:'IBM Plex Mono',monospace; font-size:10.5px; letter-spacing:.06em; padding:2px 7px; border-radius:2px; text-transform:uppercase; }
.t-ok { background:var(--teal-l); color:var(--teal-d); }
.t-warn { background:var(--amber-l); color:var(--amber); }
.t-bad { background:var(--red-l); color:var(--red); }
.t-mut { background:var(--line2); color:var(--muted); }

.life { height:5px; background:var(--line2); border-radius:2px; overflow:hidden; min-width:64px; }
.life i { display:block; height:100%; }
.life.ok i { background:var(--teal); } .life.warning i { background:var(--amber); }
.life.critical i { background:var(--red); } .life.expired i { background:var(--red); }

.sugg-wrap { position:relative; }
.sugg { position:absolute; z-index:40; top:calc(100% + 4px); left:0; right:0; background:#fff; border:1px solid var(--line); border-radius:2px; box-shadow:0 10px 28px rgba(15,34,51,.14); max-height:330px; overflow-y:auto; }
.sugg-i { padding:9px 12px; cursor:pointer; border-bottom:1px solid var(--line2); display:flex; gap:10px; align-items:center; }
.sugg-i:last-child { border-bottom:none; }
.sugg-i:hover, .sugg-i.hi { background:var(--teal-l); }
.sugg-h { padding:6px 12px; background:#F5F9FA; border-bottom:1px solid var(--line2); }

.ov { position:fixed; inset:0; background:rgba(15,34,51,.55); display:flex; align-items:flex-start; justify-content:center; padding:26px 16px; z-index:80; overflow-y:auto; }
.modal { background:#fff; border-radius:3px; width:100%; max-width:520px; }

.receipt { background:#fff; font-family:'IBM Plex Mono',monospace; font-size:12px; padding:22px; color:#000; }
.receipt hr { border:none; border-top:1px dashed #999; margin:9px 0; }
.receipt .row { display:flex; justify-content:space-between; gap:10px; }
.perf { border-top:2px dashed var(--line); }

.banner { display:flex; gap:10px; align-items:flex-start; padding:11px 14px; border-radius:2px; font-size:13px; }
.b-bad { background:var(--red-l); color:var(--red); }
.b-ok { background:var(--teal-l); color:var(--teal-d); }
.b-warn { background:var(--amber-l); color:var(--amber); }

.empty { text-align:center; padding:44px 20px; color:var(--muted); }

@media print {
  body * { visibility:hidden; }
  .print-me, .print-me * { visibility:visible; }
  .print-me { position:absolute; left:0; top:0; width:100%; }
  .no-print { display:none !important; }
}
@media (prefers-reduced-motion:reduce){ .rx * { transition:none !important; animation:none !important; } }
`;

/* ============================================================
   SMALL UI PIECES
   ============================================================ */
const Field = ({ label, hint, children }) => (
  <div className="f">
    <label>{label}</label>
    {children}
    {hint && <span className="hint">{hint}</span>}
  </div>
);

const Input = (p) => <input {...p} />;

function ExpiryTag({ date }) {
  const s = expiryState(date);
  const cls =
    s.key === "expired" || s.key === "critical"
      ? "t-bad"
      : s.key === "warning"
        ? "t-warn"
        : "t-ok";
  return <span className={`tag ${cls}`}>{s.label}</span>;
}

function LifeBar({ date, addedAt }) {
  const s = expiryState(date);
  const total = Math.max(
    1,
    Math.round((new Date(date) - new Date(addedAt || Date.now())) / 86400000),
  );
  const pct =
    s.days <= 0 ? 100 : Math.max(4, Math.min(100, (s.days / total) * 100));
  return (
    <div className={`life ${s.key}`} title={`${s.days} days`}>
      <i style={{ width: pct + "%" }} />
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  const c =
    tone === "bad"
      ? "var(--red)"
      : tone === "warn"
        ? "var(--amber)"
        : "var(--teal)";
  return (
    <div className="stat" style={{ borderLeftColor: c }}>
      <div className="eyebrow">{label}</div>
      <div className="n" style={{ color: tone ? c : "var(--ink)" }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   AUTH SCREEN WITH ROLE SELECTION
   ============================================================ */
function Auth({ users, onSignup, onLogin, onReset }) {
  const [mode, setMode] = useState(users.length ? "login" : "signup");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [pharmacy, setPharmacy] = useState("");
  const [role, setRole] = useState("Pharmacist");
  const [pw2, setPw2] = useState("");
  const [q, setQ] = useState("Which city was your first posting in?");
  const [a, setA] = useState("");

  const [rStage, setRStage] = useState(1);
  const [rUser, setRUser] = useState(null);
  const [rAns, setRAns] = useState("");

  const say = (e, o = "") => {
    setErr(e);
    setOk(o);
  };

  const submitSignup = async () => {
    say("");
    if (!name.trim() || !email.trim() || !pw)
      return say("Fill in name, email and password.");
    if (!/^\S+@\S+\.\S+$/.test(email))
      return say("That email address doesn't look right.");
    if (pw.length < 8) return say("Password needs at least 8 characters.");
    if (pw !== pw2) return say("The two passwords don't match.");
    if (!a.trim())
      return say("Add a security answer so you can recover this account.");
    if (users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase()))
      return say("An account already uses this email.");
    setBusy(true);
    await onSignup({
      name: name.trim(),
      email: email.trim(),
      pharmacy: pharmacy.trim(),
      role,
      pw,
      q,
      a: a.trim(),
    });
    setBusy(false);
  };

  const submitLogin = async () => {
    say("");
    setBusy(true);
    const r = await onLogin(email.trim(), pw);
    setBusy(false);
    if (r) say(r);
  };

  const findUser = () => {
    const u = users.find(
      (x) => x.email.toLowerCase() === email.trim().toLowerCase(),
    );
    if (!u) return say("No account found for that email.");
    setRUser(u);
    setRStage(2);
    say("");
  };
  const doReset = async () => {
    say("");
    if (pw.length < 8) return say("New password needs at least 8 characters.");
    if (pw !== pw2) return say("The two passwords don't match.");
    setBusy(true);
    const r = await onReset(rUser, rAns.trim(), pw);
    setBusy(false);
    if (r) return say(r);
    setMode("login");
    setRStage(1);
    setPw("");
    setPw2("");
    say("", "Password updated. Sign in with the new one.");
  };

  const title =
    mode === "signup"
      ? users.length
        ? "Create a staff account"
        : "Set up the pharmacy"
      : mode === "login"
        ? "Sign in"
        : "Reset your password";

  return (
    <div className="rx">
      <style>{CSS}</style>
      <div className="auth">
        <div className="auth-side">
          <div>
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                marginBottom: 30,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  background: "var(--teal)",
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 2,
                }}
              >
                <Pill size={18} color="#fff" />
              </div>
              <div>
                <div
                  className="disp"
                  style={{ fontSize: 17, fontWeight: 600, color: "#fff" }}
                >
                  APOTHECA
                </div>
                <div className="eyebrow" style={{ color: "#7FA0B3" }}>
                  Professional pharmacy system
                </div>
              </div>
            </div>
            <h1
              style={{
                fontSize: 34,
                lineHeight: 1.1,
                margin: "0 0 12px",
                color: "#fff",
                maxWidth: 420,
              }}
            >
              Multi-role hospital pharmacy management.
            </h1>
            <p style={{ color: "#9FBACA", maxWidth: 420, margin: 0 }}>
              Admin controls staff & inventory. Pharmacists dispense. Doctors
              write e-prescriptions. Patient IDs prevent name collisions.
            </p>
          </div>
          <div style={{ position: "relative", zIndex: 2, maxWidth: 420 }}>
            <div className="strip">
              <div className="eyebrow" style={{ color: "#7FA0B3" }}>
                Role-Based Access
              </div>
              <div style={{ color: "#DCE8EF" }}>
                Admin, Pharmacist, Doctor — each with tailored permissions.
              </div>
            </div>
            <div className="strip">
              <div className="eyebrow" style={{ color: "#7FA0B3" }}>
                Patient IDs
              </div>
              <div style={{ color: "#DCE8EF" }}>
                Unique identifiers eliminate duplicate name confusion.
              </div>
            </div>
            <div className="strip">
              <div className="eyebrow" style={{ color: "#7FA0B3" }}>
                E-Prescriptions
              </div>
              <div style={{ color: "#DCE8EF" }}>
                Doctors write, pharmacy fulfills — full audit trail.
              </div>
            </div>
          </div>
        </div>

        <div className="auth-form">
          <div className="auth-inner">
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              {mode === "signup" && !users.length
                ? "First run"
                : mode === "reset"
                  ? "Account recovery"
                  : "Staff access"}
            </div>
            <h2 style={{ fontSize: 26, margin: "0 0 18px" }}>{title}</h2>

            {err && (
              <div className="banner b-bad" style={{ marginBottom: 14 }}>
                <AlertTriangle size={16} />
                <span>{err}</span>
              </div>
            )}
            {ok && (
              <div className="banner b-ok" style={{ marginBottom: 14 }}>
                <CheckCircle2 size={16} />
                <span>{ok}</span>
              </div>
            )}

            <div style={{ display: "grid", gap: 13 }}>
              {mode === "signup" && (
                <>
                  <Field label="Full name">
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Dr. A. Sharma"
                    />
                  </Field>
                  {!users.length && (
                    <Field label="Hospital/Pharmacy name">
                      <Input
                        value={pharmacy}
                        onChange={(e) => setPharmacy(e.target.value)}
                        placeholder="City Hospital Pharmacy"
                      />
                    </Field>
                  )}
                  <Field label="Role">
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                    >
                      <option value="Chief Pharmacist">
                        Chief Pharmacist (Admin)
                      </option>
                      <option value="Pharmacist">Pharmacist</option>
                      <option value="Pharmacy Staff">Pharmacy Staff</option>
                      <option value="Doctor">Doctor</option>
                      <option value="Nurse">Nurse</option>
                    </select>
                  </Field>
                  <Field label="Email">
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@hospital.in"
                    />
                  </Field>
                  <div className="grid g2">
                    <Field label="Password" hint="8+ chars">
                      <Input
                        type="password"
                        value={pw}
                        onChange={(e) => setPw(e.target.value)}
                      />
                    </Field>
                    <Field label="Repeat">
                      <Input
                        type="password"
                        value={pw2}
                        onChange={(e) => setPw2(e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field label="Security Q">
                    <select value={q} onChange={(e) => setQ(e.target.value)}>
                      <option>Which city was your first posting in?</option>
                      <option>What is your pharmacy licence number?</option>
                      <option>First school name?</option>
                      <option>Mother's maiden name?</option>
                    </select>
                  </Field>
                  <Field label="Answer">
                    <Input value={a} onChange={(e) => setA(e.target.value)} />
                  </Field>
                  <button
                    className="btn p full"
                    disabled={busy}
                    onClick={submitSignup}
                  >
                    {busy ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      <ShieldCheck size={16} />
                    )}{" "}
                    Create account
                  </button>
                  {!!users.length && (
                    <button
                      className="link"
                      style={{ textAlign: "center" }}
                      onClick={() => {
                        setMode("login");
                        say("");
                      }}
                    >
                      Back to sign in
                    </button>
                  )}
                </>
              )}

              {mode === "login" && (
                <>
                  <Field label="Email">
                    <Input
                      type="email"
                      value={email}
                      autoComplete="username"
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && submitLogin()}
                    />
                  </Field>
                  <Field label="Password">
                    <Input
                      type="password"
                      value={pw}
                      autoComplete="current-password"
                      onChange={(e) => setPw(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && submitLogin()}
                    />
                  </Field>
                  <button
                    className="btn p full"
                    disabled={busy}
                    onClick={submitLogin}
                  >
                    {busy ? "Checking…" : "Sign in"}
                  </button>
                  <div
                    style={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <button
                      className="link"
                      onClick={() => {
                        setMode("reset");
                        setRStage(1);
                        say("");
                      }}
                    >
                      Forgot?
                    </button>
                    <button
                      className="link"
                      onClick={() => {
                        setMode("signup");
                        say("");
                      }}
                    >
                      Create account
                    </button>
                  </div>
                </>
              )}

              {mode === "reset" && (
                <>
                  {rStage === 1 && (
                    <>
                      <Field label="Email">
                        <Input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </Field>
                      <button className="btn p full" onClick={findUser}>
                        <KeyRound size={16} /> Continue
                      </button>
                    </>
                  )}
                  {rStage === 2 && (
                    <>
                      <div
                        className="card"
                        style={{ padding: 12, background: "#F7FAFB" }}
                      >
                        <div className="eyebrow">Security question</div>
                        <div style={{ fontWeight: 600 }}>{rUser.q}</div>
                      </div>
                      <Field label="Answer">
                        <Input
                          value={rAns}
                          onChange={(e) => setRAns(e.target.value)}
                        />
                      </Field>
                      <Field label="New password">
                        <Input
                          type="password"
                          value={pw}
                          onChange={(e) => setPw(e.target.value)}
                        />
                      </Field>
                      <Field label="Repeat">
                        <Input
                          type="password"
                          value={pw2}
                          onChange={(e) => setPw2(e.target.value)}
                        />
                      </Field>
                      <button
                        className="btn p full"
                        disabled={busy}
                        onClick={doReset}
                      >
                        Update password
                      </button>
                    </>
                  )}
                  <button
                    className="link"
                    style={{ textAlign: "center", width: "100%" }}
                    onClick={() => {
                      setMode("login");
                      say("");
                    }}
                  >
                    Back to sign in
                  </button>
                </>
              )}
            </div>

            <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 22 }}>
              Passwords are hashed with SHA-256. For production, use bcrypt or
              Argon2 on a server.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   MEDICINE TYPE-AHEAD
   ============================================================ */
function MedicineSearch({
  value,
  onChange,
  onPick,
  stock,
  placeholder,
  autoFocus,
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef(null);

  useEffect(() => {
    const h = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const results = useMemo(() => {
    const q = (value || "").trim().toLowerCase();
    if (q.length < 2) return [];
    const out = [];
    CATALOG.forEach((c) => {
      const hitG = c.g.toLowerCase().includes(q);
      const hitB = c.brands.some((b) => b.toLowerCase().includes(q));
      if (!hitG && !hitB) return;
      c.forms.forEach((f) =>
        f.strengths.forEach((s) => {
          const batches = stock.filter(
            (it) => it.name === c.g && it.form === f.form && it.strength === s,
          );
          const qty = batches.reduce(
            (n, b) => n + (expiryState(b.expiry).key === "expired" ? 0 : b.qty),
            0,
          );
          const nearest = batches
            .filter((b) => expiryState(b.expiry).key !== "expired")
            .sort((a, b) => new Date(a.expiry) - new Date(b.expiry))[0];
          out.push({
            g: c.g,
            brands: c.brands,
            cls: c.cls,
            sch: c.sch,
            form: f.form,
            strength: s,
            qty,
            nearest,
            batches,
          });
        }),
      );
    });
    out.sort((a, b) => (b.qty > 0) - (a.qty > 0) || a.g.localeCompare(b.g));
    return out.slice(0, 30);
  }, [value, stock]);

  useEffect(() => {
    setHi(0);
  }, [value]);

  const choose = (r) => {
    onPick(r);
    setOpen(false);
  };

  return (
    <div className="sugg-wrap" ref={box}>
      <div style={{ position: "relative" }}>
        <Search
          size={15}
          style={{
            position: "absolute",
            left: 10,
            top: 11,
            color: "var(--muted)",
          }}
        />
        <input
          style={{
            paddingLeft: 32,
            border: "1px solid var(--line)",
            borderRadius: 2,
            padding: "9px 10px 9px 32px",
            width: "100%",
            background: "#FCFDFE",
          }}
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder || "Start typing…"}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open || !results.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => Math.min(h + 1, results.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              choose(results[hi]);
            }
            if (e.key === "Escape") setOpen(false);
          }}
        />
      </div>
      {open && (value || "").trim().length >= 2 && (
        <div className="sugg">
          {results.length === 0 && (
            <div style={{ padding: 14, color: "var(--muted)", fontSize: 13 }}>
              No matches. Enter manually below.
            </div>
          )}
          {results.length > 0 && (
            <div className="sugg-h eyebrow">Matches — {results.length}</div>
          )}
          {results.map((r, i) => (
            <div
              key={i}
              className={`sugg-i ${i === hi ? "hi" : ""}`}
              onMouseEnter={() => setHi(i)}
              onClick={() => choose(r)}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  {r.g}{" "}
                  <span className="mono" style={{ color: "var(--teal-d)" }}>
                    {r.strength}
                  </span>
                  <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                    {" "}
                    · {r.form}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  {r.brands.slice(0, 3).join(" · ")} — {r.cls}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                {r.qty > 0 ? (
                  <>
                    <div
                      className="mono"
                      style={{ fontSize: 12.5, fontWeight: 600 }}
                    >
                      {r.qty} {PACK_UNIT(r.form)}
                    </div>
                    {r.nearest && (
                      <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
                        exp {fmtDate(r.nearest.expiry)}
                      </div>
                    )}
                  </>
                ) : (
                  <span className="tag t-mut">Out</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   ADD MEDICINE - IMPROVED FOR MULTIPLE ITEMS
   ============================================================ */
const blank = {
  name: "",
  brand: "",
  form: "Tablet",
  strength: "",
  qty: "",
  batchNo: "",
  expiry: "",
  mrp: "",
  cost: "",
  gst: "12",
  mfr: "",
  rack: "",
  reorder: "20",
  cls: "",
  sch: "OTC",
};

function AddMedicine({ stock, onAdd, user }) {
  const [f, setF] = useState(blank);
  const [strengths, setStrengths] = useState([]);
  const [custom, setCustom] = useState(false);
  const [msg, setMsg] = useState(null);
  const [items, setItems] = useState([]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const pick = (r) => {
    setF((s) => ({
      ...s,
      name: r.g,
      form: r.form,
      strength: r.strength,
      brand: r.brands[0] || "",
      cls: r.cls,
      sch: r.sch,
    }));
    const c = CATALOG.find((x) => x.g === r.g);
    const fm = c && c.forms.find((x) => x.form === r.form);
    setStrengths(fm ? fm.strengths : []);
    setCustom(false);
  };

  const existing = useMemo(
    () =>
      stock.filter(
        (it) =>
          it.name.toLowerCase() === f.name.toLowerCase() &&
          (!f.strength || it.strength === f.strength),
      ),
    [stock, f.name, f.strength],
  );

  const submit = async () => {
    if (!f.name.trim() || !f.strength.trim())
      return setMsg({ t: "bad", m: "Medicine name and strength required." });
    if (!f.qty || Number(f.qty) <= 0)
      return setMsg({ t: "bad", m: "Enter quantity received." });
    if (!f.batchNo.trim())
      return setMsg({ t: "bad", m: "Batch number required." });
    if (!f.expiry) return setMsg({ t: "bad", m: "Enter expiry date." });
    if (!f.mrp || Number(f.mrp) <= 0)
      return setMsg({ t: "bad", m: "Enter MRP per unit." });
    if (daysLeft(f.expiry) < 0)
      return setMsg({ t: "bad", m: "Date has passed." });
    const dup = stock.find(
      (it) =>
        it.batchNo.toLowerCase() === f.batchNo.trim().toLowerCase() &&
        it.name === f.name.trim(),
    );
    if (dup)
      return setMsg({ t: "bad", m: `Batch ${f.batchNo} already on shelf.` });

    const newItem = {
      id: uid(),
      name: f.name.trim(),
      brand: f.brand.trim(),
      form: f.form,
      strength: f.strength.trim(),
      qty: Number(f.qty),
      batchNo: f.batchNo.trim().toUpperCase(),
      expiry: f.expiry,
      mrp: Number(f.mrp),
      cost: Number(f.cost || 0),
      gst: Number(f.gst || 0),
      mfr: f.mfr.trim(),
      rack: f.rack.trim().toUpperCase(),
      reorder: Number(f.reorder || 0),
      cls: f.cls,
      sch: f.sch,
      addedAt: new Date().toISOString(),
      addedBy: user.name,
    };

    setItems([...items, newItem]);
    setMsg({ t: "ok", m: `✓ ${f.name} added to cart.` });
    setF({ ...blank, form: f.form });
    setStrengths([]);
    setCustom(false);
  };

  const saveAll = async () => {
    if (!items.length)
      return setMsg({ t: "bad", m: "Add at least one medicine." });
    for (const item of items) {
      await onAdd(item);
    }
    setMsg({
      t: "ok",
      m: `✓ ${items.length} batch${items.length > 1 ? "es" : ""} added!`,
    });
    setItems([]);
    setTimeout(() => setMsg(null), 3000);
  };

  const removeItem = (id) => {
    setItems(items.filter((i) => i.id !== id));
  };

  return (
    <div className="pad" style={{ display: "grid", gap: 16, maxWidth: 1080 }}>
      <div>
        <div className="eyebrow">Goods inward</div>
        <h2 style={{ fontSize: 22, margin: "2px 0 0" }}>
          Add stock — Multiple items
        </h2>
      </div>

      {msg && (
        <div className={`banner ${msg.t === "ok" ? "b-ok" : "b-bad"}`}>
          {msg.t === "ok" ? (
            <CheckCircle2 size={16} />
          ) : (
            <AlertTriangle size={16} />
          )}
          <span>{msg.m}</span>
        </div>
      )}

      <div
        className="grid"
        style={{
          gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1fr)",
          alignItems: "start",
          gap: 16,
        }}
      >
        <div style={{ display: "grid", gap: 14 }}>
          <div className="card">
            <div className="card-h">
              <Search size={15} />
              <strong>Find medicine</strong>
              <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
                2+ letters or brand name
              </span>
            </div>
            <div className="card-b" style={{ display: "grid", gap: 12 }}>
              <MedicineSearch
                value={f.name}
                onChange={(v) => setF((s) => ({ ...s, name: v }))}
                onPick={pick}
                stock={stock}
                autoFocus
              />

              {existing.length > 0 && (
                <div className="card" style={{ background: "#F7FAFB" }}>
                  <div className="card-h" style={{ padding: "8px 12px" }}>
                    <Package size={14} />
                    <span className="eyebrow">
                      On shelf — {existing.length}
                    </span>
                  </div>
                  <div className="scroll">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Strength</th>
                          <th>Batch</th>
                          <th>Qty</th>
                          <th>Exp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {existing.map((it) => (
                          <tr key={it.id}>
                            <td>{it.strength}</td>
                            <td className="mono">{it.batchNo}</td>
                            <td className="mono">{it.qty}</td>
                            <td className="mono">
                              <ExpiryTag date={it.expiry} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <Pill size={15} />
              <strong>Batch details</strong>
            </div>
            <div className="card-b" style={{ display: "grid", gap: 12 }}>
              <div className="grid g3">
                <Field label="Medicine">
                  <Input
                    value={f.name}
                    onChange={set("name")}
                    placeholder="Paracetamol"
                  />
                </Field>
                <Field label="Brand">
                  <Input
                    value={f.brand}
                    onChange={set("brand")}
                    placeholder="Dolo"
                  />
                </Field>
                <Field label="Manufacturer">
                  <Input
                    value={f.mfr}
                    onChange={set("mfr")}
                    placeholder="Micro Labs"
                  />
                </Field>
              </div>

              <div className="grid g3">
                <Field label="Form">
                  <select
                    value={f.form}
                    onChange={(e) => {
                      set("form")(e);
                      setStrengths([]);
                      setCustom(false);
                    }}
                  >
                    {FORMS.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Strength">
                  {strengths.length && !custom ? (
                    <select
                      value={f.strength}
                      onChange={(e) => {
                        if (e.target.value === "__") {
                          setCustom(true);
                          setF((s) => ({ ...s, strength: "" }));
                        } else set("strength")(e);
                      }}
                    >
                      <option value="">Select…</option>
                      {strengths.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                      <option value="__">Other</option>
                    </select>
                  ) : (
                    <Input
                      value={f.strength}
                      onChange={set("strength")}
                      placeholder="500 mg"
                    />
                  )}
                </Field>
                <Field label={`Quantity (${PACK_UNIT(f.form)})`}>
                  <Input
                    type="number"
                    min="1"
                    value={f.qty}
                    onChange={set("qty")}
                    placeholder="100"
                  />
                </Field>
              </div>

              <div className="grid g3">
                <Field label="Batch #">
                  <Input
                    value={f.batchNo}
                    onChange={set("batchNo")}
                    placeholder="DL2419"
                  />
                </Field>
                <Field
                  label="Expiry"
                  hint={f.expiry ? `${daysLeft(f.expiry)}d left` : ""}
                >
                  <Input
                    type="date"
                    value={f.expiry}
                    onChange={set("expiry")}
                  />
                </Field>
                <Field label="Rack">
                  <Input
                    value={f.rack}
                    onChange={set("rack")}
                    placeholder="A-01"
                  />
                </Field>
              </div>

              <div className="grid g4">
                <Field label="MRP (₹)">
                  <Input
                    type="number"
                    step="0.01"
                    value={f.mrp}
                    onChange={set("mrp")}
                  />
                </Field>
                <Field label="Cost (₹)">
                  <Input
                    type="number"
                    step="0.01"
                    value={f.cost}
                    onChange={set("cost")}
                  />
                </Field>
                <Field label="GST">
                  <select value={f.gst} onChange={set("gst")}>
                    {["0", "5", "12", "18"].map((x) => (
                      <option key={x} value={x}>
                        {x}%
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Reorder">
                  <Input
                    type="number"
                    value={f.reorder}
                    onChange={set("reorder")}
                  />
                </Field>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn p" onClick={submit} style={{ flex: 1 }}>
                  <Plus size={16} /> Add to cart
                </button>
                <button
                  className="btn g"
                  onClick={() => {
                    setF(blank);
                    setStrengths([]);
                  }}
                  style={{ flex: 1 }}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <div className="card">
            <div className="card-h">
              <strong>Cart</strong>
              <span className="eyebrow">{items.length}</span>
            </div>
            {items.length === 0 ? (
              <div className="empty" style={{ padding: 30 }}>
                <Pill size={26} />
                <p>Add medicines above</p>
              </div>
            ) : (
              <div className="scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Medicine</th>
                      <th>Batch</th>
                      <th>Qty</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{item.name}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            {item.strength}
                          </div>
                        </td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {item.batchNo}
                        </td>
                        <td className="mono">{item.qty}</td>
                        <td>
                          <button
                            className="btn sm g"
                            onClick={() => removeItem(item.id)}
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {items.length > 0 && (
              <div
                style={{
                  borderTop: "1px solid var(--line2)",
                  padding: "12px 16px",
                  display: "flex",
                  gap: 10,
                }}
              >
                <button className="btn p" onClick={saveAll} style={{ flex: 1 }}>
                  <CheckCircle2 size={15} /> Save all
                </button>
                <button
                  className="btn g"
                  onClick={() => setItems([])}
                  style={{ flex: 1 }}
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   INVENTORY WITH DELETE CONFIRMATION
   ============================================================ */
function Inventory({ stock, onDelete, onAdjust, user }) {
  const [q, setQ] = useState("");
  const [form, setForm] = useState("All");
  const [sort, setSort] = useState("expiry");
  const [delConfirm, setDelConfirm] = useState(null);
  const [delText, setDelText] = useState("");

  const rows = useMemo(() => {
    let r = stock.filter((it) => {
      const t =
        `${it.name} ${it.brand} ${it.batchNo} ${it.strength} ${it.mfr}`.toLowerCase();
      return (
        t.includes(q.toLowerCase()) && (form === "All" || it.form === form)
      );
    });
    r.sort((a, b) =>
      sort === "expiry"
        ? new Date(a.expiry) - new Date(b.expiry)
        : sort === "qty"
          ? a.qty - b.qty
          : a.name.localeCompare(b.name),
    );
    return r;
  }, [stock, q, form, sort]);

  const confirmDelete = (item) => {
    if (!["Chief Pharmacist", "Admin"].includes(user.role)) {
      alert("Only administrators can delete stock.");
      return;
    }
    setDelConfirm(item);
    setDelText("");
  };

  const executDelete = () => {
    if (!delConfirm || delText !== "DELETE") return;
    onDelete(delConfirm.id);
    setDelConfirm(null);
  };

  return (
    <div className="pad" style={{ display: "grid", gap: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div className="eyebrow">Shelf</div>
          <h2 style={{ fontSize: 22, margin: "2px 0 0" }}>Stock on hand</h2>
        </div>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ position: "relative" }}>
            <Search
              size={15}
              style={{
                position: "absolute",
                left: 10,
                top: 11,
                color: "var(--muted)",
              }}
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              style={{
                paddingLeft: 32,
                border: "1px solid var(--line)",
                borderRadius: 2,
                padding: "9px 10px 9px 32px",
                minWidth: 250,
                background: "#fff",
              }}
            />
          </div>
          <select
            value={form}
            onChange={(e) => setForm(e.target.value)}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 2,
              padding: "9px 10px",
              background: "#fff",
            }}
          >
            <option>All</option>
            {FORMS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 2,
              padding: "9px 10px",
              background: "#fff",
            }}
          >
            <option value="expiry">Expiry first</option>
            <option value="qty">Quantity</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      <div className="card">
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Strength</th>
                <th>Batch</th>
                <th>Expiry</th>
                <th>Qty</th>
                <th>MRP</th>
                <th>Rack</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => {
                const st = expiryState(it.expiry);
                const low = it.qty <= it.reorder;
                return (
                  <tr
                    key={it.id}
                    style={
                      st.key === "expired"
                        ? { background: "var(--red-l)" }
                        : undefined
                    }
                  >
                    <td>
                      <div style={{ fontWeight: 600 }}>{it.name}</div>
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                        {it.brand || "—"}
                      </div>
                    </td>
                    <td>
                      <span className="mono">{it.strength}</span>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        {it.form}
                      </div>
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {it.batchNo}
                    </td>
                    <td>
                      <div className="mono">{fmtDate(it.expiry)}</div>
                      <ExpiryTag date={it.expiry} />
                    </td>
                    <td>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <button
                          className="btn sm"
                          onClick={() => onAdjust(it.id, -1)}
                          disabled={it.qty <= 0}
                        >
                          −
                        </button>
                        <span
                          className="mono"
                          style={{
                            minWidth: 34,
                            textAlign: "center",
                            fontWeight: 600,
                            color: low ? "var(--amber)" : undefined,
                          }}
                        >
                          {it.qty}
                        </span>
                        <button
                          className="btn sm"
                          onClick={() => onAdjust(it.id, 1)}
                        >
                          +
                        </button>
                      </div>
                      {low && (
                        <span className="tag t-warn" style={{ marginTop: 4 }}>
                          Reorder
                        </span>
                      )}
                    </td>
                    <td className="mono">{money(it.mrp)}</td>
                    <td className="mono">{it.rack || "—"}</td>
                    <td>
                      <button
                        className="btn sm d"
                        title="Delete (admin)"
                        onClick={() => confirmDelete(it)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <div className="empty">
            <Boxes size={26} />
            <p>No matches.</p>
          </div>
        )}
      </div>

      {delConfirm && (
        <div className="ov" onClick={() => setDelConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-h" style={{ background: "var(--red-l)" }}>
              <AlertTriangle size={16} />
              <strong>Delete from shelf</strong>
              <button
                className="btn sm g"
                style={{ marginLeft: "auto" }}
                onClick={() => setDelConfirm(null)}
              >
                <X size={15} />
              </button>
            </div>
            <div className="card-b" style={{ display: "grid", gap: 12 }}>
              <div>
                <strong>
                  {delConfirm.name} {delConfirm.strength}
                </strong>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  Batch: {delConfirm.batchNo} · Qty: {delConfirm.qty} · Expires:{" "}
                  {fmtDate(delConfirm.expiry)}
                </div>
              </div>
              <Field label="Type 'DELETE' to confirm">
                <Input
                  value={delText}
                  onChange={(e) => setDelText(e.target.value)}
                  placeholder="Type DELETE"
                />
              </Field>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  className="btn d"
                  onClick={executDelete}
                  disabled={delText !== "DELETE"}
                  style={{ flex: 1 }}
                >
                  <Trash2 size={15} /> Remove
                </button>
                <button
                  className="btn g"
                  onClick={() => setDelConfirm(null)}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   BILLING (KEEP EXISTING - Works well)
   ============================================================ */
function Billing({ stock, user, pharmacy, bills, onBill }) {
  const PAYMENT_OPTIONS = [
    "Cash",
    "Paytm",
    "GPay",
    "UPI",
    "Debit Card",
    "Credit Card",
    "Net Banking",
    "Insurance",
    "Other",
  ];

  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(null);
  const [cart, setCart] = useState([]);
  const [patient, setPatient] = useState("");
  const [patientId, setPatientId] = useState("");
  const [doctor, setDoctor] = useState("");
  const [disc, setDisc] = useState("0");
  const [pay, setPay] = useState("Cash");
  const [payRef, setPayRef] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);

  const addBatch = (b, n = 1) => {
    if (expiryState(b.expiry).key === "expired") {
      setErr(`Batch ${b.batchNo} expired. Can't dispense.`);
      return;
    }
    const e = cart.find((x) => x.id === b.id);
    if (e && e.qty + n > b.qty) {
      setErr(`Only ${b.qty} left in batch ${b.batchNo}.`);
      return;
    }
    setErr("");
    setCart((c) =>
      e
        ? c.map((x) => (x.id === b.id ? { ...x, qty: x.qty + n } : x))
        : [
            ...c,
            {
              id: b.id,
              name: b.name,
              brand: b.brand,
              form: b.form,
              strength: b.strength,
              batchNo: b.batchNo,
              expiry: b.expiry,
              mrp: b.mrp,
              gst: b.gst,
              qty: n,
              stock: b.qty,
            },
          ],
    );
    setPicked(null);
    setQ("");
  };

  const setQty = (id, v) => {
    const line = cart.find((x) => x.id === id);
    if (!line) return;
    const s = stock.find((i) => i.id === id);
    const max = s ? s.qty : line.stock;
    const n = Math.max(1, Math.min(Number(v) || 1, max));
    setErr(Number(v) > max ? `Only ${max} left.` : "");
    setCart((c) => c.map((x) => (x.id === id ? { ...x, qty: n } : x)));
  };

  const totals = useMemo(() => {
    let sub = 0,
      gst = 0;
    cart.forEach((l) => {
      const line = l.mrp * l.qty;
      const base = line / (1 + l.gst / 100);
      sub += base;
      gst += line - base;
    });
    const gross = sub + gst;
    const d = Math.min(Number(disc) || 0, 100);
    const dAmt = gross * (d / 100);
    return { sub, gst, gross, dAmt, net: gross - dAmt };
  }, [cart, disc]);

  const finish = async () => {
    if (!cart.length) return setErr("Add at least one medicine.");
    if (!patient.trim()) return setErr("Enter patient name.");
    const billAt = new Date();
    const no = `${(pharmacy || "RX").slice(0, 2).toUpperCase()}/${billAt.getFullYear()}/${String(bills.length + 1).padStart(4, "0")}`;
    const bill = {
      id: uid(),
      no,
      at: billAt.toISOString(),
      patient: patient.trim(),
      patientId: patientId.trim(),
      doctor: doctor.trim(),
      pay,
      payRef: payRef.trim(),
      by: user.name,
      pharmacy,
      lines: cart.map((l) => ({ ...l })),
      sub: totals.sub,
      gstTotal: totals.gst,
      discPct: Number(disc) || 0,
      discAmt: totals.dAmt,
      net: totals.net,
    };
    await onBill(bill);
    setDone(bill);
    setCart([]);
    setPatient("");
    setPatientId("");
    setDoctor("");
    setDisc("0");
    setPay("Cash");
    setPayRef("");
    setErr("");
  };

  const live = stock.filter((s) => s.qty > 0);

  return (
    <div className="pad" style={{ display: "grid", gap: 16 }}>
      <div>
        <div className="eyebrow">Counter</div>
        <h2 style={{ fontSize: 22, margin: "2px 0 0" }}>Dispense & bill</h2>
      </div>

      {err && (
        <div className="banner b-bad">
          <AlertTriangle size={16} />
          <span>{err}</span>
        </div>
      )}

      <div
        className="grid"
        style={{
          gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1fr)",
          alignItems: "start",
        }}
      >
        <div style={{ display: "grid", gap: 14 }}>
          <div className="card">
            <div className="card-h">
              <Search size={15} />
              <strong>Add medicine</strong>
            </div>
            <div className="card-b" style={{ display: "grid", gap: 12 }}>
              <MedicineSearch
                value={q}
                onChange={setQ}
                stock={live}
                onPick={(r) => setPicked(r)}
                placeholder="Type medicine…"
              />
              {picked && (
                <div className="card" style={{ background: "#F7FAFB" }}>
                  <div className="card-h" style={{ padding: "9px 12px" }}>
                    <strong>
                      {picked.g} {picked.strength} · {picked.form}
                    </strong>
                    <button
                      className="btn sm g"
                      style={{ marginLeft: "auto" }}
                      onClick={() => setPicked(null)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="card-b" style={{ padding: 0 }}>
                    {picked.batches.length === 0 ? (
                      <div style={{ padding: 14, color: "var(--muted)" }}>
                        No batches on shelf.
                      </div>
                    ) : (
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Batch</th>
                            <th>Expiry</th>
                            <th>Qty</th>
                            <th>MRP</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {picked.batches
                            .sort(
                              (a, b) => new Date(a.expiry) - new Date(b.expiry),
                            )
                            .map((b) => {
                              const st = expiryState(b.expiry);
                              return (
                                <tr key={b.id}>
                                  <td className="mono">{b.batchNo}</td>
                                  <td>
                                    <span className="mono">
                                      {fmtDate(b.expiry)}
                                    </span>{" "}
                                    <ExpiryTag date={b.expiry} />
                                  </td>
                                  <td className="mono">{b.qty}</td>
                                  <td className="mono">{money(b.mrp)}</td>
                                  <td>
                                    <button
                                      className="btn sm p"
                                      disabled={
                                        st.key === "expired" || b.qty <= 0
                                      }
                                      onClick={() => addBatch(b)}
                                    >
                                      <Plus size={13} /> Add
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <Receipt size={15} />
              <strong>Bill</strong>
              <span className="eyebrow" style={{ marginLeft: "auto" }}>
                {cart.length} items
              </span>
            </div>
            {cart.length === 0 ? (
              <div className="empty">
                <Receipt size={26} />
                <p>No medicines.</p>
              </div>
            ) : (
              <div className="scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Medicine</th>
                      <th>Batch</th>
                      <th>Qty</th>
                      <th>Rate</th>
                      <th>Amt</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>
                            {l.name}{" "}
                            <span
                              className="mono"
                              style={{ color: "var(--teal-d)" }}
                            >
                              {l.strength}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            {l.brand} · {l.form}
                          </div>
                        </td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {l.batchNo}
                        </td>
                        <td>
                          <input
                            type="number"
                            min="1"
                            value={l.qty}
                            onChange={(e) => setQty(l.id, e.target.value)}
                            className="mono"
                            style={{
                              width: 50,
                              border: "1px solid var(--line)",
                              borderRadius: 2,
                              padding: "6px 8px",
                            }}
                          />
                        </td>
                        <td className="mono">{money(l.mrp)}</td>
                        <td className="mono" style={{ fontWeight: 600 }}>
                          {money(l.mrp * l.qty)}
                        </td>
                        <td>
                          <button
                            className="btn sm g"
                            onClick={() =>
                              setCart((c) => c.filter((x) => x.id !== l.id))
                            }
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <div className="card">
            <div className="card-h">
              <strong>Patient</strong>
            </div>
            <div className="card-b" style={{ display: "grid", gap: 12 }}>
              <Field label="Patient name">
                <Input
                  value={patient}
                  onChange={(e) => setPatient(e.target.value)}
                  placeholder="Ramesh Kumar"
                />
              </Field>
              <Field label="Patient ID">
                <Input
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  placeholder="PAT-12345"
                />
              </Field>
              <Field label="Doctor">
                <Input
                  value={doctor}
                  onChange={(e) => setDoctor(e.target.value)}
                  placeholder="Dr. Sharma"
                />
              </Field>
              <Field label="Payment mode">
                <select value={pay} onChange={(e) => setPay(e.target.value)}>
                  {PAYMENT_OPTIONS.map((opt) => (
                    <option key={opt}>{opt}</option>
                  ))}
                </select>
              </Field>
              {pay !== "Cash" && pay !== "Insurance" && (
                <Field label="Reference / UPI ID / Card last 4">
                  <Input
                    value={payRef}
                    onChange={(e) => setPayRef(e.target.value)}
                    placeholder={
                      pay === "Paytm"
                        ? "Paytm wallet no"
                        : pay === "GPay"
                          ? "gpay@upi"
                          : pay === "UPI"
                            ? "name@upi"
                            : pay === "Debit Card" || pay === "Credit Card"
                              ? "XXXX-XXXX-XXXX-1234"
                              : "Ref / transaction ID"
                    }
                  />
                </Field>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <strong>Total</strong>
            </div>
            <div className="card-b" style={{ display: "grid", gap: 9 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted)" }}>Taxable</span>
                <span className="mono">{money(totals.sub)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted)" }}>GST</span>
                <span className="mono">{money(totals.gst)}</span>
              </div>
              <Field label="Discount %">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={disc}
                  onChange={(e) => setDisc(e.target.value)}
                />
              </Field>
              {totals.dAmt > 0 && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    color: "var(--amber)",
                  }}
                >
                  <span>Discount</span>
                  <span className="mono">− {money(totals.dAmt)}</span>
                </div>
              )}
              <div
                className="perf"
                style={{
                  paddingTop: 10,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <strong>Payable</strong>
                <span
                  className="disp mono"
                  style={{ fontSize: 26, fontWeight: 600 }}
                >
                  {money(totals.net)}
                </span>
              </div>
              <button
                className="btn p full"
                onClick={finish}
                disabled={!cart.length}
              >
                <Receipt size={16} /> Bill
              </button>
            </div>
          </div>
        </div>
      </div>

      {done && <BillModal bill={done} onClose={() => setDone(null)} />}
    </div>
  );
}

/* ============================================================
   BILL RECEIPT MODAL
   ============================================================ */
function BillModal({ bill, onClose }) {
  return (
    <div className="ov" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 460 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-h no-print">
          <CheckCircle2 size={16} color="var(--teal)" />
          <strong>Bill {bill.no}</strong>
          <button
            className="btn sm g"
            style={{ marginLeft: "auto" }}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
        <div className="receipt print-me">
          <div style={{ textAlign: "center" }}>
            <div
              style={{ fontWeight: 600, fontSize: 14, letterSpacing: ".06em" }}
            >
              {(bill.pharmacy || "HOSPITAL PHARMACY").toUpperCase()}
            </div>
            <div>Tax invoice — pharmacy counter</div>
          </div>
          <hr />
          <div className="row">
            <span>Bill no</span>
            <span>{bill.no}</span>
          </div>
          <div className="row">
            <span>Date & time</span>
            <span>
              {new Date(bill.at).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </div>
          <div className="row">
            <span>Patient</span>
            <span>{bill.patient}</span>
          </div>
          {bill.patientId && (
            <div className="row">
              <span>Patient ID</span>
              <span>{bill.patientId}</span>
            </div>
          )}
          {bill.doctor && (
            <div className="row">
              <span>Doctor</span>
              <span>{bill.doctor}</span>
            </div>
          )}
          <div className="row">
            <span>Dispensed by</span>
            <span>{bill.by}</span>
          </div>
          <hr />
          {bill.lines.map((l, i) => (
            <div key={i} style={{ marginBottom: 7 }}>
              <div>
                {i + 1}. {l.name} {l.strength}
              </div>
              <div style={{ color: "#555" }}>
                {" "}
                {l.form} · B/N {l.batchNo} · Exp {fmtDate(l.expiry)}
              </div>
              <div className="row">
                <span>
                  {" "}
                  {l.qty} × {money(l.mrp)}
                </span>
                <span>{money(l.qty * l.mrp)}</span>
              </div>
            </div>
          ))}
          <hr />
          <div className="row">
            <span>Taxable value</span>
            <span>{money(bill.sub)}</span>
          </div>
          <div className="row">
            <span>GST</span>
            <span>{money(bill.gstTotal)}</span>
          </div>
          {bill.discAmt > 0 && (
            <div className="row">
              <span>Discount ({bill.discPct}%)</span>
              <span>− {money(bill.discAmt)}</span>
            </div>
          )}
          <hr />
          <div className="row" style={{ fontWeight: 600, fontSize: 14 }}>
            <span>PAYABLE</span>
            <span>{money(bill.net)}</span>
          </div>
          <div className="row">
            <span>Paid by</span>
            <span>{bill.pay}</span>
          </div>
          {bill.payRef && (
            <div className="row">
              <span>Ref</span>
              <span>{bill.payRef}</span>
            </div>
          )}
          <hr />
          <div style={{ textAlign: "center", color: "#555" }}>
            Medicines once sold are not returnable.
            <br />
            Check expiry before use.
          </div>
        </div>
        <div
          className="card-b no-print"
          style={{
            display: "flex",
            gap: 10,
            borderTop: "1px solid var(--line2)",
          }}
        >
          <button className="btn p" onClick={() => window.print()}>
            <Printer size={15} /> Print
          </button>
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   BILL HISTORY
   ============================================================ */
function Bills({ bills }) {
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState("");
  const rows = bills
    .filter((b) =>
      `${b.no} ${b.patient} ${b.doctor} ${b.patientId}`
        .toLowerCase()
        .includes(q.toLowerCase()),
    )
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  const total = bills.reduce((n, b) => n + b.net, 0);

  return (
    <div className="pad" style={{ display: "grid", gap: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div className="eyebrow">Records</div>
          <h2 style={{ fontSize: 22, margin: "2px 0 0" }}>Billing history</h2>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Bill, patient or ID"
            style={{
              border: "1px solid var(--line)",
              borderRadius: 2,
              padding: "9px 10px",
              minWidth: 240,
              background: "#fff",
            }}
          />
        </div>
      </div>

      <div className="grid g3">
        <Stat label="Bills" value={bills.length} />
        <Stat label="Total revenue" value={money(total)} />
        <Stat
          label="Average bill"
          value={money(bills.length ? total / bills.length : 0)}
        />
      </div>

      <div className="card">
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Bill</th>
                <th>Date</th>
                <th>Patient</th>
                <th>ID</th>
                <th>Items</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td
                    className="mono"
                    style={{ fontWeight: 600, fontSize: 11 }}
                  >
                    {b.no}
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {new Date(b.at).toLocaleDateString("en-IN")}
                  </td>
                  <td>{b.patient}</td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {b.patientId || "—"}
                  </td>
                  <td className="mono">{b.lines.length}</td>
                  <td className="mono" style={{ fontWeight: 600 }}>
                    {money(b.net)}
                  </td>
                  <td>
                    <button className="btn sm" onClick={() => setOpen(b)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <div className="empty">
            <Receipt size={26} />
            <p>No bills yet.</p>
          </div>
        )}
      </div>
      {open && <BillModal bill={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ============================================================
   EXPIRY DESK
   ============================================================ */
function Expiry({ stock, onDelete }) {
  const groups = useMemo(() => {
    const g = { expired: [], critical: [], warning: [] };
    stock.forEach((it) => {
      const k = expiryState(it.expiry).key;
      if (g[k]) g[k].push(it);
    });
    Object.values(g).forEach((a) =>
      a.sort((x, y) => new Date(x.expiry) - new Date(y.expiry)),
    );
    return g;
  }, [stock]);

  const lossValue = groups.expired.reduce(
    (n, i) => n + i.qty * (i.cost || i.mrp),
    0,
  );

  const Block = ({ title, note, items, action }) => (
    <div className="card">
      <div className="card-h">
        <strong>{title}</strong>
        <span className="eyebrow">{items.length}</span>
        <span
          style={{ color: "var(--muted)", fontSize: 12.5, marginLeft: "auto" }}
        >
          {note}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="empty" style={{ padding: 26 }}>
          Nothing here
        </div>
      ) : (
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Batch</th>
                <th>Expiry</th>
                <th>Qty</th>
                <th>Value</th>
                {action && <th></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{it.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {it.brand} · {it.form}
                    </div>
                  </td>
                  <td className="mono">{it.batchNo}</td>
                  <td>
                    <span className="mono">{fmtDate(it.expiry)}</span>{" "}
                    <ExpiryTag date={it.expiry} />
                  </td>
                  <td className="mono">{it.qty}</td>
                  <td className="mono">
                    {money(it.qty * (it.cost || it.mrp))}
                  </td>
                  {action && (
                    <td>
                      <button
                        className="btn sm d"
                        onClick={() => onDelete(it.id)}
                      >
                        <Trash2 size={13} /> Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="pad" style={{ display: "grid", gap: 16 }}>
      <div>
        <div className="eyebrow">Quality control</div>
        <h2 style={{ fontSize: 22, margin: "2px 0 0" }}>Expiry desk</h2>
      </div>

      {groups.expired.length > 0 && (
        <div className="banner b-bad">
          <AlertTriangle size={16} />
          <span>
            <strong>{groups.expired.length} expired batches!</strong> Loss:{" "}
            {money(lossValue)}
          </span>
        </div>
      )}

      <div className="grid g3">
        <Stat
          label="Expired"
          value={groups.expired.length}
          tone={groups.expired.length ? "bad" : undefined}
        />
        <Stat
          label="Critical (30d)"
          value={groups.critical.length}
          tone={groups.critical.length ? "warn" : undefined}
        />
        <Stat label="Warning (90d)" value={groups.warning.length} />
      </div>

      <Block title="Expired" note="Must remove" items={groups.expired} action />
      <Block
        title="Expiring in 30 days"
        note="Use first"
        items={groups.critical}
        action
      />
      <Block
        title="Expiring in 90 days"
        note="Rotate stock"
        items={groups.warning}
      />
    </div>
  );
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function Dashboard({ stock, bills, user, go }) {
  const expired = stock.filter((i) => expiryState(i.expiry).key === "expired");
  const soon = stock.filter((i) =>
    ["critical"].includes(expiryState(i.expiry).key),
  );
  const low = stock.filter(
    (i) => i.qty <= i.reorder && expiryState(i.expiry).key !== "expired",
  );
  const value = stock.reduce((n, i) => n + i.qty * (i.cost || i.mrp), 0);
  const todayStr = new Date().toDateString();
  const todayBills = bills.filter(
    (b) => new Date(b.at).toDateString() === todayStr,
  );
  const todaySale = todayBills.reduce((n, b) => n + b.net, 0);

  return (
    <div className="pad" style={{ display: "grid", gap: 16 }}>
      <div>
        <div className="eyebrow">Welcome</div>
        <h2 style={{ fontSize: 22, margin: "2px 0 0" }}>
          Hi, {user.name.split(" ")[0]} ({user.role})
        </h2>
      </div>

      {expired.length > 0 && (
        <div className="banner b-bad">
          <AlertTriangle size={16} />
          <span>
            {expired.length} expired.{" "}
            <button
              className="link"
              style={{ color: "inherit", textDecoration: "underline" }}
              onClick={() => go("expiry")}
            >
              Open expiry desk
            </button>
          </span>
        </div>
      )}

      <div className="grid g4">
        <Stat label="Batches" value={stock.length} />
        <Stat label="Stock value (₹)" value={money(value)} />
        <Stat
          label="Today's sales (₹)"
          value={money(todaySale)}
          sub={`${todayBills.length} bills`}
        />
        <Stat
          label="Needs attention"
          value={expired.length + soon.length + low.length}
          tone={
            expired.length
              ? "bad"
              : soon.length || low.length
                ? "warn"
                : undefined
          }
        />
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-h">
            <CalendarClock size={15} />
            <strong>Expiring soon</strong>
            <button
              className="btn sm g"
              style={{ marginLeft: "auto" }}
              onClick={() => go("expiry")}
            >
              All
            </button>
          </div>
          <div className="scroll">
            <table className="tbl">
              <tbody>
                {[...stock]
                  .sort((a, b) => new Date(a.expiry) - new Date(b.expiry))
                  .slice(0, 6)
                  .map((it) => (
                    <tr key={it.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{it.name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>
                          B/N {it.batchNo}
                        </div>
                      </td>
                      <td style={{ width: 90 }}>
                        <LifeBar date={it.expiry} addedAt={it.addedAt} />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <ExpiryTag date={it.expiry} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!stock.length && <div className="empty">Shelf is empty</div>}
        </div>

        <div className="card">
          <div className="card-h">
            <Package size={15} />
            <strong>Low stock</strong>
            <button
              className="btn sm g"
              style={{ marginLeft: "auto" }}
              onClick={() => go("inventory")}
            >
              All
            </button>
          </div>
          {low.length === 0 ? (
            <div className="empty" style={{ padding: 30 }}>
              All good
            </div>
          ) : (
            <div className="scroll">
              <table className="tbl">
                <tbody>
                  {low.slice(0, 6).map((it) => (
                    <tr key={it.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{it.name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>
                          Rack {it.rack || "—"}
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span
                          className="mono"
                          style={{ fontWeight: 600, color: "var(--amber)" }}
                        >
                          {it.qty}
                        </span>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>
                          reorder {it.reorder}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <Receipt size={15} />
          <strong>Latest bills</strong>
          <button
            className="btn sm g"
            style={{ marginLeft: "auto" }}
            onClick={() => go("bills")}
          >
            All
          </button>
        </div>
        {bills.length === 0 ? (
          <div className="empty" style={{ padding: 30 }}>
            No bills yet
          </div>
        ) : (
          <div className="scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Patient</th>
                  <th>Items</th>
                  <th>Time</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {[...bills]
                  .sort((a, b) => new Date(b.at) - new Date(a.at))
                  .slice(0, 5)
                  .map((b) => (
                    <tr key={b.id}>
                      <td
                        className="mono"
                        style={{ fontWeight: 600, fontSize: 11 }}
                      >
                        {b.no}
                      </td>
                      <td>{b.patient}</td>
                      <td className="mono">{b.lines.length}</td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {new Date(b.at).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="mono" style={{ fontWeight: 600 }}>
                        {money(b.net)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   STAFF & SETTINGS (ADMIN ONLY)
   ============================================================ */
function Staff({ users, user, stock, bills, onExport, onReset, onResetPassword }) {
  const isAdmin = ["Chief Pharmacist", "Admin"].includes(user.role);
  const [expandId, setExpandId] = useState(null);
  const [resetUser, setResetUser] = useState(null);
  const [newPw, setNewPw] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState("");

  if (!isAdmin) {
    return (
      <div className="pad">
        <div className="banner b-warn">
          <AlertTriangle size={16} />
          <span>Staff & settings are for administrators only.</span>
        </div>
      </div>
    );
  }

  const handleResetPassword = async () => {
    if (!newPw.trim() || newPw.length < 8) {
      return setResetMsg({t: "bad", m: "Password must be 8+ characters"});
    }
    setResetBusy(true);
    await onResetPassword(resetUser, newPw);
    setResetBusy(false);
    setResetMsg({t: "ok", m: `Password reset for ${resetUser.name}`});
    setNewPw("");
    setTimeout(() => {
      setResetUser(null);
      setResetMsg("");
    }, 2000);
  };

  return (
    <div className="pad" style={{ display: "grid", gap: 16 }}>
      <div>
        <div className="eyebrow">Administration</div>
        <h2 style={{ fontSize: 22, margin: "2px 0 0" }}>Staff management</h2>
      </div>

      <div className="card">
        <div className="card-h">
          <Users size={15} />
          <strong>All staff members</strong>
          <span className="eyebrow" style={{ marginLeft: "auto" }}>
            {users.length} staff
          </span>
        </div>
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>User ID</th>
                <th>Email</th>
                <th>Role</th>
                <th>Access Level</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const roleInfo = ROLES[u.role];
                return (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>
                      {u.name}
                      {u.id === user.id && (
                        <span className="tag t-ok" style={{ marginLeft: 8 }}>
                          You
                        </span>
                      )}
                    </td>
                    <td
                      className="mono"
                      style={{ fontSize: 10, color: "#666" }}
                    >
                      {u.id.slice(0, 8)}
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {u.email}
                    </td>
                    <td>
                      <span
                        className="tag"
                        style={{
                          background: getRoleColor(u.role),
                          color: "#fff",
                        }}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontSize: 12, color: "#555" }}>
                        L{roleInfo?.level || 0}
                      </div>
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {fmtDate(u.createdAt)}
                    </td>
                    <td>
                      <button
                        className="btn sm"
                        onClick={() =>
                          setExpandId(expandId === u.id ? null : u.id)
                        }
                        style={{ fontSize: 12 }}
                      >
                        {expandId === u.id ? "▼" : "▶"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {expandId && (
        <div className="card">
          <div className="card-h">
            <ShieldCheck size={15} />
            <strong>
              {users.find((u) => u.id === expandId)?.name} — Permissions
            </strong>
          </div>
          <div className="card-b">
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <div className="eyebrow">Full ID</div>
                <div
                  className="mono"
                  style={{
                    fontSize: 11,
                    background: "#f5f5f5",
                    padding: "8px 10px",
                    borderRadius: 2,
                    marginTop: 4,
                    userSelect: "all",
                  }}
                >
                  {users.find((u) => u.id === expandId)?.id}
                </div>
              </div>
              <table className="tbl" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th style={{ textAlign: "center" }}>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: "dashboard", name: "Dashboard" },
                    { key: "addStock", name: "Add stock" },
                    { key: "inventory", name: "Inventory" },
                    { key: "billing", name: "Billing" },
                    { key: "bills", name: "Bills history" },
                    { key: "expiry", name: "Expiry desk" },
                    { key: "prescriptions", name: "Prescriptions" },
                    { key: "staff", name: "Staff & Admin" },
                    { key: "settings", name: "Settings" },
                  ].map((feature) => {
                    const u = users.find((x) => x.id === expandId);
                    const access = ROLES[u?.role]?.access[feature.key];
                    return (
                      <tr key={feature.key}>
                        <td>{feature.name}</td>
                        <td style={{ textAlign: "center" }}>
                          {access ? (
                            <span
                              style={{
                                color: "#1a7f4a",
                                fontWeight: 600,
                                fontSize: 12,
                              }}
                            >
                              ✓ Yes
                            </span>
                          ) : (
                            <span style={{ color: "#999", fontSize: 12 }}>
                              ✗ No
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-h">
          <ShieldCheck size={15} />
          <strong>Role hierarchy</strong>
        </div>
        <div className="card-b">
          <div style={{ display: "grid", gap: 10 }}>
            {Object.entries(ROLES)
              .sort((a, b) => b[1].level - a[1].level)
              .map(([role, info]) => (
                <div
                  key={role}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    background: "#f9f9f9",
                    borderLeft: `4px solid ${getRoleColor(role)}`,
                  }}
                >
                  <div style={{ fontWeight: 600, minWidth: 150 }}>{role}</div>
                  <div style={{ color: "#666", fontSize: 12 }}>
                    Level {info.level}
                  </div>
                  <div
                    style={{
                      marginLeft: "auto",
                      fontSize: 11,
                      color: "#999",
                    }}
                  >
                    {Object.values(info.access).filter(Boolean).length}/9
                    features
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <Boxes size={15} />
          <strong>Database</strong>
        </div>
        <div className="card-b" style={{ display: "grid", gap: 12 }}>
          <div className="grid g3">
            <Stat label="Stock records" value={stock.length} />
            <Stat label="Bill records" value={bills.length} />
            <Stat label="User records" value={users.length} />
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn" onClick={onExport}>
              <Download size={15} /> Export JSON
            </button>
            <button className="btn d" onClick={onReset}>
              <RotateCcw size={15} /> Wipe data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ROOT
   ============================================================ */
export default function PharmacySystem() {
  const [ready, setReady] = useState(false);
  const [users, setUsers] = useState([]);
  const [user, setUser] = useState(null);
  const [stock, setStock] = useState([]);
  const [bills, setBills] = useState([]);
  const [tab, setTab] = useState("dashboard");
  const [userMenu, setUserMenu] = useState(false);

  useEffect(() => {
    (async () => {
      const u = await dbGet(K.users, []);
      let s = await dbGet(K.stock, null);
      const b = await dbGet(K.bills, []);
      const sess = await dbGet(K.session, null);
      if (s === null) {
        s = seedStock();
        await dbSet(K.stock, s);
      }
      setUsers(u);
      setStock(s);
      setBills(b);
      if (sess) {
        const f = u.find((x) => x.id === sess);
        if (f) setUser(f);
      }
      setReady(true);
    })();
  }, []);

  const saveStock = async (next) => {
    setStock(next);
    await dbSet(K.stock, next);
  };
  const saveBills = async (next) => {
    setBills(next);
    await dbSet(K.bills, next);
  };

  const signup = async ({ name, email, pharmacy, role, pw, q, a }) => {
    const salt = randSalt();
    const nu = {
      id: uid(),
      roleId: genRoleId(role, users),
      name,
      email,
      pharmacy:
        pharmacy || (users[0] && users[0].pharmacy) || "Hospital Pharmacy",
      role: role || (users.length ? "Pharmacist" : "Chief Pharmacist"),
      salt,
      pass: await hash(pw, salt),
      q,
      ans: await hash(a.toLowerCase(), salt),
      createdAt: new Date().toISOString(),
    };
    const next = [...users, nu];
    setUsers(next);
    await dbSet(K.users, next);
    setUser(nu);
    await dbSet(K.session, nu.id);
  };

  const login = async (email, pw) => {
    const u = users.find((x) => x.email.toLowerCase() === email.toLowerCase());
    if (!u) return "No account uses that email.";
    const h = await hash(pw, u.salt);
    if (h !== u.pass) return "Password doesn't match.";
    setUser(u);
    await dbSet(K.session, u.id);
    return null;
  };

  const reset = async (ru, ans, newPw) => {
    const h = await hash(ans.toLowerCase(), ru.salt);
    if (h !== ru.ans) return "Answer doesn't match.";
    const salt = randSalt();
    const next = users.map((x) =>
      x.id === ru.id ? { ...x, salt, pass: null } : x,
    );
    const idx = next.findIndex((x) => x.id === ru.id);
    next[idx].pass = await hash(newPw, salt);
    next[idx].ans = await hash(ans.toLowerCase(), salt);
    setUsers(next);
    await dbSet(K.users, next);
    return null;
  };

  const resetStaffPassword = async (staffUser, newPw) => {
    const salt = randSalt();
    const next = users.map((x) =>
      x.id === staffUser.id
        ? { ...x, salt, pass: await hash(newPw, salt) }
        : x
    );
    setUsers(next);
    await dbSet(K.users, next);
    return null;
  };

  const addStock = async (item) => saveStock([...stock, item]);
  const delStock = async (id) => saveStock(stock.filter((i) => i.id !== id));
  const adjStock = async (id, d) =>
    saveStock(
      stock.map((i) =>
        i.id === id ? { ...i, qty: Math.max(0, i.qty + d) } : i,
      ),
    );

  const makeBill = async (bill) => {
    await saveBills([...bills, bill]);
    const next = stock.map((i) => {
      const l = bill.lines.find((x) => x.id === i.id);
      return l ? { ...i, qty: Math.max(0, i.qty - l.qty) } : i;
    });
    await saveStock(next);
  };

  const exportAll = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          { users, stock, bills, exportedAt: new Date().toISOString() },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pharmacy-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const wipe = async () => {
    if (!window.confirm("Clear stock & bills? Staff accounts stay.")) return;
    await saveStock([]);
    await saveBills([]);
  };

  // Close user menu when clicking outside
  useEffect(() => {
    const handler = () => setUserMenu(false);
    if (userMenu) document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [userMenu]);

  if (!ready)
    return (
      <div
        className="rx"
        style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}
      >
        <style>{CSS}</style>
        <div style={{ textAlign: "center", color: "var(--muted)" }}>
          <Pill size={26} />
          <p>Loading…</p>
        </div>
      </div>
    );

  if (!user)
    return (
      <Auth users={users} onSignup={signup} onLogin={login} onReset={reset} />
    );

  const expiredCount = stock.filter(
    (i) => expiryState(i.expiry).key === "expired",
  ).length;
  const NAV = [
    { k: "dashboard", t: "Dashboard", i: LayoutGrid },
    { k: "add", t: "Add stock", i: Plus },
    { k: "inventory", t: "Stock", i: Boxes, n: stock.length },
    { k: "billing", t: "Dispense", i: Receipt },
    { k: "bills", t: "Bills", i: Printer, n: bills.length },
    {
      k: "expiry",
      t: "Expiry",
      i: CalendarClock,
      n: expiredCount || undefined,
    },
    { k: "staff", t: "Admin", i: Users },
  ];

  return (
    <div className="rx">
      <style>{CSS}</style>
      <div className="shell">
        <nav className="rail no-print">
          <div className="rail-brand">
            <div
              style={{
                width: 30,
                height: 30,
                background: "var(--teal)",
                display: "grid",
                placeItems: "center",
                borderRadius: 2,
              }}
            >
              <Pill size={16} color="#fff" />
            </div>
            <div>
              <div
                className="disp"
                style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}
              >
                APOTHECA
              </div>
              <div className="eyebrow" style={{ color: "#7FA0B3" }}>
                Professional Pharmacy
              </div>
            </div>
          </div>
          {NAV.map((n) => (
            <button
              key={n.k}
              className={`nav ${tab === n.k ? "on" : ""}`}
              onClick={() => setTab(n.k)}
            >
              <n.i size={16} /> {n.t}
              {n.n !== undefined && n.n !== 0 && (
                <span className="cnt">{n.n}</span>
              )}
            </button>
          ))}
          <button
            className="nav"
            style={{ marginTop: "auto" }}
            onClick={logout}
          >
            <LogOut size={16} /> Sign out
          </button>
        </nav>

        <div className="main">
          <header className="topbar no-print">
            <div>
              <strong className="disp" style={{ fontSize: 16 }}>
                {NAV.find((n) => n.k === tab)?.t}
              </strong>
            </div>
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              {expiredCount > 0 && (
                <span className="tag t-bad">
                  <AlertTriangle size={12} /> {expiredCount}
                </span>
              )}
              <button
                onClick={() => setUserMenu(!userMenu)}
                style={{
                  textAlign: "right",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{user.name}</div>
                <div className="eyebrow" style={{ fontSize: 11 }}>
                  {user.role} · {user.id.slice(0, 8)}
                </div>
              </button>
              {userMenu && (
                <div
                  style={{
                    position: "absolute",
                    top: 50,
                    right: 16,
                    background: "#fff",
                    border: "1px solid var(--line)",
                    borderRadius: 4,
                    padding: "12px 16px",
                    minWidth: 280,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    zIndex: 1000,
                  }}
                >
                  <div style={{ marginBottom: 12 }}>
                    <div className="eyebrow">Local User ID</div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 11,
                        background: "#f5f5f5",
                        padding: "6px 8px",
                        borderRadius: 2,
                        marginTop: 4,
                        userSelect: "all",
                      }}
                    >
                      {user.id}
                    </div>
                  </div>
                  <hr style={{ margin: "8px 0" }} />
                  <div style={{ fontSize: 12, color: "#555" }}>
                    <div>Name: {user.name}</div>
                    <div>Email: {user.email}</div>
                    <div>Role: {user.role}</div>
                    <div>Pharmacy: {user.pharmacy}</div>
                  </div>
                </div>
              )}
            </div>
          </header>

          {tab === "dashboard" && (
            <Dashboard stock={stock} bills={bills} user={user} go={setTab} />
          )}
          {tab === "add" && (
            <AddMedicine stock={stock} onAdd={addStock} user={user} />
          )}
          {tab === "inventory" && (
            <Inventory
              stock={stock}
              onDelete={delStock}
              onAdjust={adjStock}
              user={user}
            />
          )}
          {tab === "billing" && (
            <Billing
              stock={stock}
              user={user}
              pharmacy={user.pharmacy}
              bills={bills}
              onBill={makeBill}
            />
          )}
          {tab === "bills" && <Bills bills={bills} />}
          {tab === "expiry" && <Expiry stock={stock} onDelete={delStock} />}
          {tab === "staff" && (
            <Staff
              users={users}
              user={user}
              stock={stock}
              bills={bills}
              onExport={exportAll}
              onReset={wipe}
              onResetPassword={resetStaffPassword}
            />
          )}
        </div>
      </div>
      {/* Close menu when clicking outside */}
      {userMenu && (
        <div
          onClick={() => setUserMenu(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999,
          }}
        />
      )}
    </div>
  );
}
