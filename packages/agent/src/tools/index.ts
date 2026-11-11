/**
 * The handler map and the plan gate.
 *
 * The model is offered only the tools its tenant's plan includes, and the
 * server refuses the rest even if the model asks for them by name. The
 * plan-to-tool map itself lives in `@webina/shared/plans` — one config file,
 * so a package can change without touching this one.
 */

import { getPlanKey } from "@webina/db";
import { PLANS, planAllowsTool, type PlanKey, type ToolName } from "@webina/shared";

import { checkAvailabilityTool } from "./check-availability";
import { checkServiceAreaTool } from "./check-service-area";
import { createBookingTool } from "./create-booking";
import { createJobRequestTool } from "./create-job-request";
import { getQuoteTool } from "./get-quote";
import { handoffToOwnerTool } from "./handoff-to-owner";
import { listServicesTool } from "./list-services";
import { toolError, type ToolContext, type ToolResult, type ToolSpec } from "./types";

export * from "./types";

/** Every tool, by name. The order is the order the model sees them in. */
export const TOOLS: Record<ToolName, ToolSpec> = {
  list_services: listServicesTool,
  get_quote: getQuoteTool,
  check_service_area: checkServiceAreaTool,
  check_availability: checkAvailabilityTool,
  create_booking: createBookingTool,
  create_job_request: createJobRequestTool,
  handoff_to_owner: handoffToOwnerTool,
};

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOLS, name);
}

/** The tool definitions to send the model for a plan — nothing it may not call. */
export function toolsForPlan(plan: PlanKey): { name: ToolName; description: string; input_schema: Record<string, unknown> }[] {
  return PLANS[plan].tools.map((name) => {
    const spec = TOOLS[name];
    return { name: spec.name, description: spec.description, input_schema: spec.inputSchema };
  });
}

/** Same list, resolved from the tenant's own subscription. */
export async function toolsForBusiness(businessId: string): Promise<{
  plan: PlanKey;
  tools: { name: ToolName; description: string; input_schema: Record<string, unknown> }[];
}> {
  const plan = await planForBusiness(businessId);
  return { plan, tools: toolsForPlan(plan) };
}

export async function planForBusiness(businessId: string): Promise<PlanKey> {
  const key = await getPlanKey(businessId);
  return (Object.hasOwn(PLANS, key) ? key : "answer") as PlanKey;
}

/**
 * Run one tool call. Never throws.
 *
 * `businessId` comes from the context the server built, so a tool can only
 * ever act on the tenant it was invoked for; the plan is read from the
 * database here, not taken from the caller.
 */
export async function runTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!isToolName(name)) {
    return toolError("invalid_input", `there is no tool called "${name}"`);
  }

  try {
    const plan = await planForBusiness(ctx.businessId);
    if (!planAllowsTool(plan, name)) {
      return toolError("invalid_input", `the ${PLANS[plan].name} plan does not include ${name}`);
    }
    return await TOOLS[name].handler(rawInput, ctx);
  } catch (error) {
    // A bug in a handler must look like a failed tool, not a stack trace in
    // the customer's chat.
    const message = error instanceof Error ? error.message : String(error);
    return toolError("tool_failed", "I could not complete that just now", {
      detail: message.slice(0, 200),
    });
  }
}

export { listServicesTool, getQuoteTool, checkServiceAreaTool, checkAvailabilityTool, createBookingTool, createJobRequestTool, handoffToOwnerTool };
