/**
 * The nine steps from sign-up to live chat, and how far along a tenant is.
 *
 * Every "done" here is read back from the database — a service row, an hours
 * rule, an audit entry — never from a flag the browser set. Refreshing the page
 * therefore tells the truth, and two people on two devices see the same thing.
 */

import type { OnboardingProgress } from "@webina/db";

export interface SetupStep {
  key: string;
  title: string;
  hint: string;
  done: boolean;
  href: string;
  /** Shown next to an unfinished step when the editor is somewhere else. */
  editor?: string;
}

export function setupSteps(progress: OnboardingProgress): SetupStep[] {
  return [
    {
      key: "template",
      title: "Pick your trade",
      hint: "A template fills in services, prices, hours and the assistant's notes. Everything is editable.",
      done: progress.templateApplied,
      href: "/business/$businessId/onboarding",
    },
    {
      key: "details",
      title: "Business and assistant details",
      hint: "The name customers see, what the assistant is called, and how it should sound.",
      done: progress.detailsSaved,
      href: "/business/$businessId/onboarding",
    },
    {
      key: "services",
      title: "Services and prices",
      hint: "The assistant only ever quotes what is on this list.",
      done: progress.serviceCount > 0,
      href: "/business/$businessId/services",
      editor: "Open the services editor",
    },
    {
      key: "area",
      title: "Service area",
      hint: "Where you work. Anything outside it becomes a request instead of a booking.",
      done: progress.areaType !== "none",
      href: "/business/$businessId/area",
      editor: "Open the area editor",
    },
    {
      key: "hours",
      title: "Opening hours",
      hint: "The times the assistant may offer.",
      done: progress.ruleCount > 0,
      href: "/business/$businessId/hours",
      editor: "Open the hours editor",
    },
    {
      key: "notifications",
      title: "Where should we send you jobs?",
      hint: "Bookings, job requests and handoffs are sent here.",
      done: progress.ownerNotifyEmail !== "",
      href: "/business/$businessId/settings",
      editor: "Open settings",
    },
    {
      key: "install",
      title: "Put the chat on your website",
      hint: "Copy one line of code, then check it is on the page.",
      done: progress.installFound,
      href: "/business/$businessId/install",
      editor: "Open the install check",
    },
    {
      key: "test",
      title: "Try it yourself",
      hint: "Chat to your own assistant before a customer does.",
      done: progress.testChatSent,
      href: "/business/$businessId/test-chat",
      editor: "Open the test chat",
    },
    {
      key: "live",
      title: "Go live",
      hint: "Turns the assistant on for real customers.",
      done: progress.status === "active" && progress.botEnabled,
      href: "/business/$businessId/onboarding",
    },
  ];
}

export function nextStep(steps: SetupStep[]): SetupStep | undefined {
  return steps.find((step) => !step.done);
}
