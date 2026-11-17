/**
 * Trade templates.
 *
 * A template is a starting point, never a rule: it pre-fills services, prices,
 * intake questions, the service area, opening hours, tone and the business
 * notes the assistant reads — and every one of those is editable in the
 * dashboard afterwards. Applying a template is what turns a blank tenant into
 * something that can answer a customer in a few minutes.
 *
 * Money is integer AUD cents. There is no GST anywhere: Web Digital Assistants
 * is a sole trader below the A$100,000 threshold.
 */

import type {
  AvailabilityRuleInput,
  ServiceAreaInput,
  ServiceInput,
  TradeTemplate,
} from "./schemas";

export interface TradeTemplatePreset {
  key: TradeTemplate;
  /** Shown in the wizard. */
  label: string;
  summary: string;
  tone: string;
  /** Read by the assistant as the business's own notes. */
  businessRules: string;
  greeting: string;
  services: ServiceInput[];
  area: ServiceAreaInput;
  hours: AvailabilityRuleInput[];
}

/** Monday to Friday, `open`–`close`, one rule per day. */
function weekdays(
  open: string,
  close: string,
  slotMinutes: number,
  capacity = 1,
): AvailabilityRuleInput[] {
  return [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: open, endTime: close, slotMinutes, capacity }));
}

const ADELAIDE_SUBURBS = ["Adelaide", "Norwood", "Prospect", "Unley", "Glenelg"];

const VEHICLE_FIELDS = [
  { key: "vehicle", question: "Vehicle make, model and year", type: "text" as const, required: true },
  { key: "rego", question: "Registration number", type: "text" as const, required: true },
];

export const TRADE_TEMPLATE_PRESETS: Record<TradeTemplate, TradeTemplatePreset> = {
  generic: {
    key: "generic",
    label: "Generic service business",
    summary: "One quote-only service and weekday hours. Add your own services and prices.",
    tone: "friendly and brief",
    businessRules:
      "Only quote the prices listed in the price list. Anything not listed is a job request the owner confirms in writing.",
    greeting: "Hi! I can help with prices, availability and bookings. What do you need?",
    services: [
      {
        name: "Standard service",
        description: "Describe the job and the owner confirms the price.",
        pricingType: "quote_only",
        schedulingType: "owner_confirms",
        durationMinutes: 60,
      },
    ],
    area: { type: "none", values: [] },
    hours: weekdays("09:00", "17:00", 60),
  },

  car_service: {
    key: "car_service",
    label: "Car service and repair",
    summary: "Logbook, brakes and pink slips, with vehicle details captured up front.",
    tone: "friendly, plain-spoken and efficient",
    businessRules: [
      "Cars are dropped off from 8am and are usually ready the same day; say the owner will confirm a pickup time.",
      "This is a workshop, not a mobile service — we do not travel to the customer.",
      "Pink slip and roadworthy prices are the inspection fee only; any repair needed after inspection is quoted separately.",
      "Insurance work and body repairs are never quoted by the assistant: take a job request.",
    ].join("\n"),
    greeting: "Hi! Need a service, a pink slip or a price? Tell me the car and what it needs.",
    services: [
      {
        name: "Logbook service",
        description: "Scheduled service to the manufacturer's logbook.",
        pricingType: "fixed",
        priceCents: 24_900,
        durationMinutes: 180,
        intakeFields: VEHICLE_FIELDS,
        sortOrder: 1,
      },
      {
        name: "Brake and clutch service",
        description: "Priced from, after we see the car.",
        pricingType: "from",
        priceCents: 32_000,
        durationMinutes: 240,
        intakeFields: VEHICLE_FIELDS,
        sortOrder: 2,
      },
      {
        name: "Pink slip (roadworthy inspection)",
        description: "Inspection fee only; repairs are quoted separately.",
        pricingType: "fixed",
        priceCents: 5_900,
        durationMinutes: 60,
        intakeFields: VEHICLE_FIELDS,
        sortOrder: 3,
      },
      {
        name: "Full vehicle detail",
        pricingType: "from",
        priceCents: 18_000,
        durationMinutes: 180,
        intakeFields: VEHICLE_FIELDS,
        sortOrder: 4,
      },
    ],
    area: { type: "suburb_list", values: ADELAIDE_SUBURBS },
    hours: [...weekdays("08:00", "17:00", 60, 2), { weekday: 6, startTime: "08:00", endTime: "12:00", slotMinutes: 60, capacity: 1 }],
  },

  lawn_mowing: {
    key: "lawn_mowing",
    label: "Lawn mowing and garden care",
    summary: "Priced by lawn size, weekly or fortnightly, with a rain-delay note.",
    tone: "friendly, practical and no fuss",
    businessRules: [
      "Prices are per visit and include mowing, edging and blowing down.",
      "Lawn size sets the price: small, medium or large. If the customer is unsure, ask roughly how long the mowing takes.",
      "Weekly and fortnightly customers keep the same day where possible.",
      "If it rains, the visit moves to the next dry day and the customer is told. A rained-out visit is never charged.",
      "Green waste removal is an extra $25 and is only offered as an extra.",
    ].join("\n"),
    greeting: "Hi! Happy to price a mow. Roughly how big is the lawn, and how often do you want it done?",
    services: [
      {
        name: "Lawn mowing",
        description: "Mow, edge and blow down. Priced by lawn size.",
        pricingType: "tiered",
        pricingConfig: {
          tierLabel: "Lawn size",
          tiers: [
            { key: "small", label: "Small (under 200 m²)", priceCents: 6_000 },
            { key: "medium", label: "Medium (200–500 m²)", priceCents: 8_500 },
            { key: "large", label: "Large (over 500 m²)", priceCents: 12_000 },
          ],
          extras: [
            { key: "hedge_trim", label: "Hedge trim", priceCents: 4_000 },
            { key: "green_waste", label: "Green waste removal", priceCents: 2_500 },
          ],
        },
        durationMinutes: 60,
        recurringOptions: ["weekly", "fortnightly", "monthly"],
        intakeFields: [
          {
            key: "access_notes",
            question: "Anything I should know about access (gate, dog, parking)?",
            type: "text",
            required: false,
          },
        ],
        sortOrder: 1,
      },
      {
        name: "Garden tidy-up",
        description: "One-off clean-up of beds, edges and weeds.",
        pricingType: "from",
        priceCents: 15_000,
        durationMinutes: 120,
        sortOrder: 2,
      },
    ],
    area: { type: "suburb_list", values: ADELAIDE_SUBURBS },
    hours: [...weekdays("07:00", "16:00", 60), { weekday: 6, startTime: "08:00", endTime: "12:00", slotMinutes: 60, capacity: 1 }],
  },

  barber: {
    key: "barber",
    label: "Barber",
    summary: "Appointments only, one chair per slot, priced per cut.",
    tone: "warm, quick and a bit dry",
    businessRules: [
      "Appointments only. One customer per slot; never promise a walk-in a chair.",
      "Prices are as listed. Anything not listed (colour, restyle) is quoted in the chair by the barber.",
      "A no-show is not chased more than once.",
      "Do not book a customer in the last 15 minutes of the day for a cut and beard.",
    ].join("\n"),
    greeting: "Hi! Want a cut, a fade or a beard trim? I can show you what's free this week.",
    services: [
      { name: "Standard cut", pricingType: "fixed", priceCents: 4_500, durationMinutes: 30, sortOrder: 1 },
      { name: "Skin fade", pricingType: "fixed", priceCents: 5_500, durationMinutes: 30, sortOrder: 2 },
      { name: "Beard trim", pricingType: "fixed", priceCents: 2_500, durationMinutes: 15, sortOrder: 3 },
      { name: "Cut and beard", pricingType: "fixed", priceCents: 6_500, durationMinutes: 45, sortOrder: 4 },
    ],
    area: { type: "none", values: [] },
    hours: [2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      startTime: "09:00",
      endTime: "17:00",
      slotMinutes: 30,
      capacity: 1,
    })),
  },

  gift_wrapping: {
    key: "gift_wrapping",
    label: "Gift wrapping",
    summary: "Request-only: the owner confirms each job and price after seeing photos.",
    tone: "cheerful and careful with detail",
    businessRules: [
      "This is a request service, not a booking: the owner confirms every job and the price after seeing the items and any photos.",
      "Ask for photos when the item is large, fragile or unusual — they help the owner quote accurately.",
      "Never promise a same-day turnaround. Say the owner will confirm timing.",
      "Prices are per item and only from the price list. Anything unusual becomes a job request with the price left to the owner.",
    ].join("\n"),
    greeting: "Hi! Tell me what you need wrapped and roughly when, and I'll get the details to the team.",
    services: [
      {
        name: "Gift wrapping — small item",
        description: "One small or medium gift, paper, ribbon and tag.",
        pricingType: "fixed",
        priceCents: 600,
        schedulingType: "owner_confirms",
        intakeFields: [
          { key: "occasion", question: "What is the occasion?", type: "text", required: false },
          { key: "item_count", question: "How many items?", type: "number", required: true },
        ],
        sortOrder: 1,
      },
      {
        name: "Gift wrapping — large or awkward item",
        description: "Bikes, hampers, oversized boxes. Priced from.",
        pricingType: "from",
        priceCents: 1_200,
        schedulingType: "owner_confirms",
        intakeFields: [
          { key: "occasion", question: "What is the occasion?", type: "text", required: false },
          { key: "item_count", question: "How many items?", type: "number", required: true },
        ],
        sortOrder: 2,
      },
      {
        name: "Hamper wrapping",
        description: "Basket or box wrap with ribbon and tag.",
        pricingType: "from",
        priceCents: 3_500,
        schedulingType: "owner_confirms",
        sortOrder: 3,
      },
      {
        name: "Corporate order (20+ items)",
        description: "Bulk wrapping for events and corporate gifts.",
        pricingType: "quote_only",
        schedulingType: "owner_confirms",
        sortOrder: 4,
      },
    ],
    area: { type: "none", values: [] },
    hours: weekdays("09:00", "17:00", 60, 3),
  },

  cleaner: {
    key: "cleaner",
    label: "Cleaning",
    summary: "Home, deep and bond cleans; bond cleans are quote-only after photos.",
    tone: "friendly and thorough",
    businessRules: [
      "Prices are per clean, not per hour, and include all products.",
      "Bond and end-of-lease cleans are quoted only after a request with photos, and never promised to pass an inspection.",
      "If the home has more than three bedrooms, take a job request instead of quoting.",
    ].join("\n"),
    greeting: "Hi! Happy to price a clean. How many bedrooms, and when would you like it done?",
    services: [
      {
        name: "Standard home clean",
        pricingType: "from",
        priceCents: 15_000,
        durationMinutes: 180,
        intakeFields: [{ key: "bedrooms", question: "How many bedrooms?", type: "number", required: true }],
        sortOrder: 1,
      },
      {
        name: "Deep clean",
        pricingType: "from",
        priceCents: 28_000,
        durationMinutes: 300,
        sortOrder: 2,
      },
      {
        name: "End-of-lease (bond) clean",
        pricingType: "quote_only",
        schedulingType: "owner_confirms",
        sortOrder: 3,
      },
      {
        name: "Office clean",
        pricingType: "from",
        priceCents: 12_000,
        durationMinutes: 120,
        sortOrder: 4,
      },
    ],
    area: { type: "suburb_list", values: ADELAIDE_SUBURBS },
    hours: weekdays("08:00", "16:00", 120),
  },

  detailer: {
    key: "detailer",
    label: "Car detailing",
    summary: "Wash, interior and full details, with paint correction quoted only.",
    tone: "straight-talking and practical",
    businessRules: [
      "The car stays with us for the day; say the owner will confirm pickup.",
      "Paint correction, ceramic coating and any paint repair are quoted only after the owner sees the car.",
      "Extra travel beyond the service area is a job request, not a booking.",
    ].join("\n"),
    greeting: "Hi! After a wash, an interior detail or the full job? Tell me the car and I'll sort a time.",
    services: [
      {
        name: "Wash and vacuum",
        pricingType: "fixed",
        priceCents: 8_000,
        durationMinutes: 90,
        intakeFields: VEHICLE_FIELDS,
        sortOrder: 1,
      },
      {
        name: "Interior detail",
        pricingType: "from",
        priceCents: 18_000,
        durationMinutes: 180,
        intakeFields: VEHICLE_FIELDS,
        sortOrder: 2,
      },
      {
        name: "Full detail (inside and out)",
        pricingType: "from",
        priceCents: 35_000,
        durationMinutes: 300,
        intakeFields: VEHICLE_FIELDS,
        sortOrder: 3,
      },
      {
        name: "Paint correction",
        pricingType: "quote_only",
        schedulingType: "owner_confirms",
        sortOrder: 4,
      },
    ],
    area: { type: "suburb_list", values: ADELAIDE_SUBURBS },
    hours: weekdays("08:00", "17:00", 90),
  },
};

export function presetFor(trade: TradeTemplate): TradeTemplatePreset {
  return TRADE_TEMPLATE_PRESETS[trade] ?? TRADE_TEMPLATE_PRESETS.generic;
}

/** The wizard's cards, in the order the owner should see them. */
export const TRADE_TEMPLATE_CHOICES: { key: TradeTemplate; label: string; summary: string }[] =
  (Object.keys(TRADE_TEMPLATE_PRESETS) as TradeTemplate[]).map((key) => ({
    key,
    label: TRADE_TEMPLATE_PRESETS[key].label,
    summary: TRADE_TEMPLATE_PRESETS[key].summary,
  }));
