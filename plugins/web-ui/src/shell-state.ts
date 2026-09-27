import type { SuggestedActivity } from "../../chassis/src/suggested-activities.ts";

export type AuthMode = "portal" | "dev";

export interface Me {
  browserErrors?: { dsn: string; release?: string; tracesSampleRate?: number };
  analytics?: { apiKey: string; host: string };
  companyName?: string | null;
  welcomeCohort?: string;
  suggestedActivities?: SuggestedActivity[];
  suggestedActivitiesGeneration?: boolean;
  individualModelAuth?: boolean;
  modelAuthConnected?: boolean;
  mode?: AuthMode;
  user: string;
  org: string;
  slackWorkspaceUrl?: string | null;
  impersonatedBy?: string | null;
  displayName?: string | null;
  permissions?: string[];
}

const VIEWS = [
  "chats",
  "inbox",
  "calendar",
  "contexts",
  "webhooks",
  "crons",
  "loops",
  "files",
  "keychain",
  "deploys",
  "memory",
  "skills",
  "settings",
] as const;
export type View = (typeof VIEWS)[number];

export const ACCOUNTANT_MODE = true;

let accountantOn: boolean = ACCOUNTANT_MODE;

export function accountantMode(): boolean {
  return accountantOn;
}

export function setAccountantMode(on: boolean): void {
  accountantOn = on;
}

const ACCOUNTANT_HIDDEN_VIEWS: readonly View[] = [
  "webhooks",
  "crons",
  "loops",
  "files",
  "keychain",
  "deploys",
  "memory",
  "skills",
];

export function isView(view: string | null | undefined): view is View {
  return (VIEWS as readonly (string | null | undefined)[]).includes(view);
}

export const appState = {
  me: null as Me | null,
  currentView: "chats" as View,
  viewRenderSeq: 0,
  topEl: null as HTMLElement | null,
  listEl: null as HTMLElement | null,
  mainEl: null as HTMLElement | null,
};

export function can(key: string): boolean {
  return appState.me?.permissions?.includes(key) === true;
}

export function canView(view: View): boolean {
  if (accountantOn && ACCOUNTANT_HIDDEN_VIEWS.includes(view)) return false;
  if (view === "loops") return can("loops");
  if (view === "inbox" || view === "calendar") return can("inbox");
  return true;
}
