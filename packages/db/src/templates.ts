/**
 * Applying a trade template to a tenant.
 *
 * One transaction: the business's tone, notes and greeting, its services, its
 * service area and its weekly hours are written together, so a half-applied
 * template can never leave a tenant that quotes prices it has no hours for.
 *
 * Re-applying is deliberate: `replace` wipes the template's own work and lays
 * it down again (the wizard's "start again from a template"), while the
 * default fills only what is empty, so an owner who has already edited their
 * prices does not lose them by clicking the wrong button.
 */

import {
  availabilityRuleInput,
  presetFor,
  serviceAreaInput,
  serviceInput,
  type TradeTemplate,
} from "@webina/shared";

import { availabilityRules, businesses, serviceAreas, services } from "./schema";
import { withTenant } from "./tenant";
import { eq } from "drizzle-orm";

export interface ApplyTemplateResult {
  trade: TradeTemplate;
  servicesCreated: number;
  areaSaved: boolean;
  hoursCreated: number;
  replaced: boolean;
}

export async function applyTradeTemplate(
  businessId: string,
  trade: TradeTemplate,
  options: { replace?: boolean } = {},
): Promise<ApplyTemplateResult> {
  const replace = options.replace ?? false;
  const preset = presetFor(trade);

  return withTenant(businessId, async (tx) => {
    await tx
      .update(businesses)
      .set({
        tradeTemplate: preset.key,
        tone: preset.tone,
        businessRules: preset.businessRules,
        greeting: preset.greeting,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, businessId));

    const existingServices = await tx
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessId, businessId));
    const fillServices = replace || existingServices.length === 0;

    let servicesCreated = 0;
    if (fillServices) {
      if (replace && existingServices.length > 0) {
        await tx.delete(services).where(eq(services.businessId, businessId));
      }
      const rows = preset.services.map((service) => serviceInput.parse(service));
      if (rows.length > 0) {
        await tx.insert(services).values(
          rows.map((row) => ({
            businessId,
            name: row.name,
            description: row.description ?? null,
            active: row.active,
            pricingType: row.pricingType,
            priceCents: row.priceCents ?? null,
            pricingConfig: row.pricingConfig,
            durationMinutes: row.durationMinutes ?? null,
            schedulingType: row.schedulingType,
            recurringOptions: row.recurringOptions,
            intakeFields: row.intakeFields,
            sortOrder: row.sortOrder,
          })),
        );
        servicesCreated = rows.length;
      }
    }

    const area = serviceAreaInput.parse(preset.area);
    const areaValues = {
      type: area.type,
      values: area.values,
      centerLat: area.centerLat == null ? null : String(area.centerLat),
      centerLng: area.centerLng == null ? null : String(area.centerLng),
      radiusKm: area.radiusKm ?? null,
    };
    await tx
      .insert(serviceAreas)
      .values({ businessId, ...areaValues })
      .onConflictDoUpdate({
        target: serviceAreas.businessId,
        set: { ...areaValues, updatedAt: new Date() },
      });

    const existingRules = await tx
      .select({ id: availabilityRules.id })
      .from(availabilityRules)
      .where(eq(availabilityRules.businessId, businessId));
    const fillHours = replace || existingRules.length === 0;

    let hoursCreated = 0;
    if (fillHours) {
      if (replace && existingRules.length > 0) {
        await tx.delete(availabilityRules).where(eq(availabilityRules.businessId, businessId));
      }
      const rows = preset.hours.map((rule) => availabilityRuleInput.parse(rule));
      if (rows.length > 0) {
        await tx.insert(availabilityRules).values(
          rows.map((rule) => ({
            businessId,
            weekday: rule.weekday,
            startTime: `${rule.startTime}:00`,
            endTime: `${rule.endTime}:00`,
            slotMinutes: rule.slotMinutes,
            capacity: rule.capacity,
          })),
        );
        hoursCreated = rows.length;
      }
    }

    return {
      trade: preset.key,
      servicesCreated,
      areaSaved: true,
      hoursCreated,
      replaced: replace,
    };
  });
}
