/**
 * Drug master catalog — the reference formulary that powers type-ahead.
 *
 * Restored to the full 33-molecule list (the last edit had trimmed it to 16).
 * Treat this as seed reference data: when you move to a server, this becomes a
 * `drugs` table and `CATALOG` becomes the offline fallback.
 */

import type { DosageForm, ProductKey, Schedule } from "./types";

export interface CatalogForm {
  readonly form: DosageForm;
  readonly strengths: readonly string[];
}

export interface CatalogDrug {
  /** Generic / molecule name. */
  readonly generic: string;
  readonly brands: readonly string[];
  readonly cls: string;
  readonly sch: Schedule;
  readonly forms: readonly CatalogForm[];
}

export const CATALOG: readonly CatalogDrug[] = [
  {
    generic: "Paracetamol",
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
    generic: "Amoxicillin + Clavulanic Acid",
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
    generic: "Azithromycin",
    brands: ["Azithral", "Zithromax", "Azee"],
    cls: "Antibiotic (Macrolide)",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["250 mg", "500 mg"] },
      { form: "Syrup", strengths: ["100 mg/5 ml", "200 mg/5 ml"] },
    ],
  },
  {
    generic: "Pantoprazole",
    brands: ["Pan", "Pantocid", "Pantop"],
    cls: "Proton Pump Inhibitor",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["20 mg", "40 mg"] },
      { form: "Injection", strengths: ["40 mg"] },
    ],
  },
  {
    generic: "Cetirizine",
    brands: ["Cetzine", "Alerid", "Okacet"],
    cls: "Antihistamine",
    sch: "OTC",
    forms: [
      { form: "Tablet", strengths: ["5 mg", "10 mg"] },
      { form: "Syrup", strengths: ["5 mg/5 ml"] },
    ],
  },
  {
    generic: "Metformin",
    brands: ["Glycomet", "Glucophage", "Obimet"],
    cls: "Antidiabetic (Biguanide)",
    sch: "H",
    forms: [{ form: "Tablet", strengths: ["500 mg", "850 mg", "1000 mg"] }],
  },
  {
    generic: "Amlodipine",
    brands: ["Amlong", "Stamlo", "Amlopres"],
    cls: "Antihypertensive (CCB)",
    sch: "H",
    forms: [{ form: "Tablet", strengths: ["2.5 mg", "5 mg", "10 mg"] }],
  },
  {
    generic: "Atorvastatin",
    brands: ["Atorva", "Lipitor", "Storvas"],
    cls: "Lipid-lowering (Statin)",
    sch: "H",
    forms: [{ form: "Tablet", strengths: ["10 mg", "20 mg", "40 mg", "80 mg"] }],
  },
  {
    generic: "Ibuprofen",
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
    generic: "Diclofenac",
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
    generic: "Omeprazole",
    brands: ["Omez", "Ocid", "Prilosec"],
    cls: "Proton Pump Inhibitor",
    sch: "H",
    forms: [{ form: "Capsule", strengths: ["20 mg", "40 mg"] }],
  },
  {
    generic: "Montelukast + Levocetirizine",
    brands: ["Montek LC", "Montair LC"],
    cls: "Anti-asthmatic / Antihistamine",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["10 mg + 5 mg"] },
      { form: "Syrup", strengths: ["4 mg + 2.5 mg/5 ml"] },
    ],
  },
  {
    generic: "Salbutamol",
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
    generic: "Metronidazole",
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
    generic: "Ondansetron",
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
    generic: "Levothyroxine",
    brands: ["Thyronorm", "Eltroxin"],
    cls: "Thyroid hormone",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["25 mcg", "50 mcg", "75 mcg", "100 mcg"] },
    ],
  },
  {
    generic: "Losartan",
    brands: ["Losar", "Repace"],
    cls: "Antihypertensive (ARB)",
    sch: "H",
    forms: [{ form: "Tablet", strengths: ["25 mg", "50 mg"] }],
  },
  {
    generic: "Ciprofloxacin",
    brands: ["Ciplox", "Cifran"],
    cls: "Antibiotic (Fluoroquinolone)",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["250 mg", "500 mg"] },
      { form: "Eye/Ear Drops", strengths: ["0.3% w/v"] },
    ],
  },
  {
    generic: "Ranitidine",
    brands: ["Zinetac", "Aciloc"],
    cls: "H2 blocker",
    sch: "H",
    forms: [{ form: "Tablet", strengths: ["150 mg", "300 mg"] }],
  },
  {
    generic: "Vitamin D3 (Cholecalciferol)",
    brands: ["Uprise-D3", "Calcirol"],
    cls: "Supplement",
    sch: "OTC",
    forms: [
      { form: "Sachet", strengths: ["60000 IU"] },
      { form: "Tablet", strengths: ["1000 IU", "2000 IU"] },
    ],
  },
  {
    generic: "Calcium + Vitamin D3",
    brands: ["Shelcal", "Calcimax"],
    cls: "Supplement",
    sch: "OTC",
    forms: [{ form: "Tablet", strengths: ["500 mg + 250 IU"] }],
  },
  {
    generic: "Insulin Human",
    brands: ["Huminsulin", "Actrapid"],
    cls: "Antidiabetic (Insulin)",
    sch: "H",
    forms: [{ form: "Injection", strengths: ["40 IU/ml", "100 IU/ml"] }],
  },
  {
    generic: "Prednisolone",
    brands: ["Wysolone", "Omnacortil"],
    cls: "Corticosteroid",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["5 mg", "10 mg", "20 mg"] },
      { form: "Syrup", strengths: ["5 mg/5 ml"] },
    ],
  },
  {
    generic: "Betamethasone",
    brands: ["Betnovate", "Betnesol"],
    cls: "Topical corticosteroid",
    sch: "H",
    forms: [
      { form: "Tube (Cream)", strengths: ["0.1% w/w"] },
      { form: "Tablet", strengths: ["0.5 mg"] },
    ],
  },
  {
    generic: "Silver Sulfadiazine",
    brands: ["Silverex", "Burnheal"],
    cls: "Topical antibacterial (burns)",
    sch: "H",
    forms: [{ form: "Tube (Cream)", strengths: ["1% w/w"] }],
  },
  {
    generic: "Povidone Iodine",
    brands: ["Betadine", "Cipladine"],
    cls: "Antiseptic",
    sch: "OTC",
    forms: [
      { form: "Tube (Ointment)", strengths: ["5% w/w", "10% w/w"] },
      { form: "Solution", strengths: ["5% w/v"] },
    ],
  },
  {
    generic: "ORS + Zinc",
    brands: ["Electral", "Walyte"],
    cls: "Rehydration",
    sch: "OTC",
    forms: [
      { form: "Sachet", strengths: ["21.8 g"] },
      { form: "Syrup", strengths: ["20 mg/5 ml"] },
    ],
  },
  {
    generic: "Domperidone",
    brands: ["Domstal", "Vomistop"],
    cls: "Prokinetic / Antiemetic",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["10 mg"] },
      { form: "Syrup", strengths: ["1 mg/ml"] },
    ],
  },
  {
    generic: "Tramadol",
    brands: ["Ultracet", "Tramazac"],
    cls: "Opioid analgesic",
    sch: "H1",
    forms: [
      { form: "Tablet", strengths: ["50 mg", "100 mg"] },
      { form: "Injection", strengths: ["50 mg/ml"] },
    ],
  },
  {
    generic: "Clopidogrel",
    brands: ["Clopilet", "Deplatt"],
    cls: "Antiplatelet",
    sch: "H",
    forms: [{ form: "Tablet", strengths: ["75 mg", "150 mg"] }],
  },
  {
    generic: "Furosemide",
    brands: ["Lasix", "Frusenex"],
    cls: "Loop diuretic",
    sch: "H",
    forms: [
      { form: "Tablet", strengths: ["40 mg"] },
      { form: "Injection", strengths: ["10 mg/ml"] },
    ],
  },
  {
    generic: "Iron + Folic Acid",
    brands: ["Autrin", "Fefol"],
    cls: "Haematinic",
    sch: "OTC",
    forms: [
      { form: "Tablet", strengths: ["100 mg + 1.5 mg"] },
      { form: "Syrup", strengths: ["50 mg/15 ml"] },
    ],
  },
  {
    generic: "Normal Saline (Sodium Chloride)",
    brands: ["NS IV"],
    cls: "IV fluid",
    sch: "H",
    forms: [
      {
        form: "IV Fluid",
        strengths: ["0.9% w/v — 500 ml", "0.9% w/v — 1000 ml"],
      },
    ],
  },
  {
    generic: "Dextrose",
    brands: ["DNS", "D5"],
    cls: "IV fluid",
    sch: "H",
    forms: [
      { form: "IV Fluid", strengths: ["5% w/v — 500 ml", "25% w/v — 100 ml"] },
    ],
  },
];

export const FORMS: readonly DosageForm[] = [
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

/** What one countable unit of a given form is called. */
export function packUnit(form: DosageForm | string): string {
  if (/Tablet|Capsule/.test(form)) return "tablets";
  if (/Syrup|Solution|Drops/.test(form)) return "bottles";
  if (/Tube/.test(form)) return "tubes";
  if (/Injection/.test(form)) return "vials";
  if (/IV Fluid/.test(form)) return "bottles";
  if (/Sachet/.test(form)) return "sachets";
  if (/Inhaler|Respule/.test(form)) return "units";
  return "units";
}

/* ------------------------------------------------------------ lookup index */

const byGeneric = new Map<string, CatalogDrug>(
  CATALOG.map((d) => [d.generic.toLowerCase(), d]),
);

export function findDrug(generic: string): CatalogDrug | undefined {
  return byGeneric.get(generic.trim().toLowerCase());
}

export function strengthsFor(
  generic: string,
  form: DosageForm,
): readonly string[] {
  return findDrug(generic)?.forms.find((f) => f.form === form)?.strengths ?? [];
}

/**
 * Every (drug, form, strength) triple the formulary knows about, flattened
 * once at module load rather than rebuilt on every keystroke as before.
 */
export interface CatalogProduct extends ProductKey {
  readonly drug: CatalogDrug;
  /** Lowercased `generic + brands + class`, precomputed for substring search. */
  readonly haystack: string;
}

export const CATALOG_PRODUCTS: readonly CatalogProduct[] = CATALOG.flatMap(
  (drug) =>
    drug.forms.flatMap((f) =>
      f.strengths.map((strength) => ({
        drug,
        name: drug.generic,
        form: f.form,
        strength,
        haystack:
          `${drug.generic} ${drug.brands.join(" ")} ${drug.cls}`.toLowerCase(),
      })),
    ),
);
