import { html, nothing, render, type TemplateResult } from "lit";
import { Building2, ExternalLink, UserPlus, X } from "lucide";
import { errMessage } from "../../chassis/src/errors";
import { clientBrief, clientFacts, EMPTY_CLIENT_PROFILE, type ClientProfile } from "./client-brief";
import { api } from "./core-bridge";
import { contextsState, ensureContexts, openProjectDetail } from "./contexts";
import { fieldSelect, icon, menuSelect } from "./ui";
import type { SuggestedActivity } from "../../chassis/src/suggested-activities.ts";

const ACTIVE_CLIENT_KEY = "qm.activeClient";
const CLIENT_SUMMARY_KEY = "qm.clientSummaries";
const ONBOARD_VALUE = "__onboard__";
const OPEN_PAGE_VALUE = "__open__";

export interface ClientEntry {
  scopeId: string;
  name: string;
}

let activeScope: string | null | undefined;
let contextsPending = false;
let toastText = "";
let toastTimer: number | null = null;
let onboardOpen = false;
let onboardSaving = false;
let onboardError = "";
let overlayEl: HTMLElement | null = null;
let onboardPicks: ClientProfile = { ...EMPTY_CLIENT_PROFILE };

export function clientList(): ClientEntry[] {
  return contextsState.list
    .filter((context) => context.project)
    .map((context) => ({ scopeId: context.scopeId, name: context.project!.name.trim() || "Untitled client" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function activeClientScope(): string | null {
  if (activeScope === undefined) {
    try {
      activeScope = localStorage.getItem(ACTIVE_CLIENT_KEY);
    } catch {
      activeScope = null;
    }
  }
  return activeScope;
}

export function activeClientName(): string | null {
  const scope = activeClientScope();
  return scope ? (clientList().find((c) => c.scopeId === scope)?.name ?? null) : null;
}

export function setActiveClient(scopeId: string | null, openSession = true): void {
  activeScope = scopeId;
  try {
    if (scopeId) localStorage.setItem(ACTIVE_CLIENT_KEY, scopeId);
    else localStorage.removeItem(ACTIVE_CLIENT_KEY);
  } catch {
    activeScope = scopeId;
  }
  const name = activeClientName();
  showClientToast(name ? `Loaded memory for ${name}` : "Showing every client");
  void Promise.all([import("./shell"), import("./sessions")]).then(([shell, sessions]) => {
    shell.renderSidebarTop();
    sessions.renderList();
    if (openSession) sessions.startNewChat(scopeId, name);
  });
}

function readSummaries(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CLIENT_SUMMARY_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function rememberSummary(scopeId: string, profile: ClientProfile): void {
  try {
    localStorage.setItem(
      CLIENT_SUMMARY_KEY,
      JSON.stringify({ ...readSummaries(), [scopeId]: `${profile.basis} · closes ${profile.closeCadence}` }),
    );
  } catch {
    return;
  }
}

export function clientGreeting(scopeId: string | null): string | null {
  const name = scopeId ? clientList().find((c) => c.scopeId === scopeId)?.name : null;
  if (!name) return null;
  const summary = readSummaries()[scopeId!];
  return `${name}${summary ? ` · ${summary}` : ""} — what should we work on?`;
}

export function clientSuggestions(scopeId: string | null): SuggestedActivity[] | null {
  const name = scopeId ? clientList().find((c) => c.scopeId === scopeId)?.name : null;
  if (!name) return null;
  return [
    { id: "code-bills", icon: "📥", title: "Code this week's bills", prompt: `Code this week's bills for ${name}.` },
    {
      id: "reconcile-feed",
      icon: "🏦",
      title: "Reconcile bank feed",
      prompt: `Reconcile the bank feed for ${name} and list anything you could not match.`,
    },
    {
      id: "client-rules",
      icon: "📚",
      title: "What rules do you follow here?",
      prompt: `What coding rules and preferences do you follow for ${name}?`,
    },
  ];
}

function showClientToast(text: string): void {
  toastText = text;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastTimer = null;
    toastText = "";
    drawClientOverlay();
  }, 4000);
  drawClientOverlay();
}

export function clientSwitcher(): TemplateResult {
  if (!contextsState.loaded && !contextsPending) {
    contextsPending = true;
    void ensureContexts().then(async () => {
      contextsPending = false;
      (await import("./shell")).renderSidebarTop();
    });
  }
  const clients = clientList();
  const scope = activeClientScope();
  return html`<div class="client-switcher">
    ${menuSelect({
      value: clients.some((c) => c.scopeId === scope) ? scope : null,
      prefix: "Client: ",
      ariaLabel: "Active client",
      className: "client-select",
      onSelect: (value) => {
        if (value === ONBOARD_VALUE) openOnboardClient();
        else if (value === OPEN_PAGE_VALUE) {
          if (scope) openProjectDetail(scope);
        } else setActiveClient(value);
      },
      options: [
        { value: null, label: "All clients", glyph: Building2 },
        ...clients.map((c) => ({ value: c.scopeId, label: c.name, glyph: Building2 })),
        ...(scope && clients.some((c) => c.scopeId === scope)
          ? [{ value: OPEN_PAGE_VALUE, label: "Open client page", glyph: ExternalLink }]
          : []),
        { value: ONBOARD_VALUE, label: "Onboard new client", glyph: UserPlus },
      ],
    })}
  </div>`;
}

export function openOnboardClient(): void {
  onboardOpen = true;
  onboardPicks = { ...EMPTY_CLIENT_PROFILE };
  onboardSaving = false;
  onboardError = "";
  void ensureContexts();
  drawClientOverlay();
  queueMicrotask(() => document.querySelector<HTMLInputElement>("#client-name")?.focus());
}

function closeOnboardClient(): void {
  onboardOpen = false;
  onboardSaving = false;
  onboardError = "";
  drawClientOverlay();
}

function profileFromForm(form: HTMLFormElement): ClientProfile {
  const data = new FormData(form);
  const profile = { ...onboardPicks };
  for (const key of Object.keys(EMPTY_CLIENT_PROFILE) as Array<keyof ClientProfile>) {
    const raw = data.get(key);
    if (typeof raw === "string") profile[key] = raw.trim() || EMPTY_CLIENT_PROFILE[key];
  }
  return profile;
}

async function submitOnboardClient(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (onboardSaving) return;
  const profile = profileFromForm(event.currentTarget as HTMLFormElement);
  if (!profile.name) {
    onboardError = "Enter the company name.";
    drawClientOverlay();
    return;
  }
  onboardSaving = true;
  onboardError = "";
  drawClientOverlay();
  try {
    const created = await api<{ project?: { id?: string } }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: profile.name }),
    });
    const id = created.project?.id;
    if (!id) throw new Error("Core returned an invalid project");
    const scopeId = `group:web-project-${id}`;
    await api("/api/soul", { method: "POST", body: JSON.stringify({ scopeId, content: clientBrief(profile) }) });
    await api("/api/clients/seed", {
      method: "POST",
      body: JSON.stringify({ scopeId, clientName: profile.name, facts: clientFacts(profile) }),
    }).catch(() => undefined);
    rememberSummary(scopeId, profile);
    await ensureContexts(true).catch(() => undefined);
    onboardOpen = false;
    onboardSaving = false;
    drawClientOverlay();
    setActiveClient(scopeId, false);
    openProjectDetail(scopeId);
  } catch (error) {
    onboardSaving = false;
    onboardError = errMessage(error, "Couldn't onboard that client.");
    drawClientOverlay();
  }
}

function pick(name: keyof ClientProfile, label: string, options: string[]): TemplateResult {
  return html`<div class="client-field">
    <span>${label}</span>
    ${fieldSelect({
      ariaLabel: label,
      value: onboardPicks[name],
      disabled: onboardSaving,
      options: options.map((o) => html`<option value=${o}>${o}</option>`),
      onChange: (value) => {
        onboardPicks[name] = value;
      },
    })}
  </div>`;
}

function text(name: keyof ClientProfile, label: string, placeholder: string, id?: string): TemplateResult {
  return html`<label class="client-field" for=${id ?? name}>
    <span>${label}</span>
    <input
      id=${id ?? name}
      name=${name}
      autocomplete="off"
      placeholder=${placeholder}
      .value=${EMPTY_CLIENT_PROFILE[name]}
      ?disabled=${onboardSaving}
    />
  </label>`;
}

function area(name: keyof ClientProfile, label: string, placeholder: string): TemplateResult {
  return html`<label class="client-field wide">
    <span>${label}</span>
    <textarea name=${name} rows="3" placeholder=${placeholder} ?disabled=${onboardSaving}></textarea>
  </label>`;
}

function onboardDialog(): TemplateResult | typeof nothing {
  if (!onboardOpen) return nothing;
  return html`
    <dialog
      class="project-dialog client-dialog"
      aria-labelledby="client-dialog-title"
      @close=${closeOnboardClient}
      @click=${(event: MouseEvent) =>
        event.target === event.currentTarget && (event.currentTarget as HTMLDialogElement).close()}
    >
      <form @submit=${(event: SubmitEvent) => void submitOnboardClient(event)}>
        <div class="project-dialog-head">
          <span class="context-glyph large">${icon(UserPlus, 21)}</span>
          <div><h2 id="client-dialog-title">Onboard a new client</h2></div>
          <button class="project-icon-button" type="button" aria-label="Close onboarding" @click=${closeOnboardClient}>
            ${icon(X, 16)}
          </button>
        </div>
        <div class="client-fields">
          ${text("name", "Company name", "Northwind Bakery", "client-name")}
          ${pick("entityType", "Entity type", ["LLC", "S-Corp", "C-Corp", "Nonprofit"])}
          ${text("industry", "Industry", "food manufacturing")}
          ${text("fiscalYearEnd", "Fiscal year end", "December 31")}
          ${pick("basis", "Accounting basis", ["accrual", "cash"])}
          ${pick("closeCadence", "Close cadence", ["monthly", "quarterly", "annually"])}
          ${text("autoPostThreshold", "Auto-post confidence", "0.9")}
          ${area("chartNotes", "Chart of accounts notes", "6100 Auto is vehicles only — fuel goes to 6120")}
          ${area("vendorRules", "Vendor rules (one per line)", "Shell / fuel card -> 6120 Fuel, not 6100 Auto")}
          ${area("preferences", "Other preferences", "Ask before touching a closed period")}
        </div>
        <div class="form-error" aria-live="polite">${onboardError}</div>
        <div class="project-dialog-actions">
          <button class="btn" type="button" @click=${closeOnboardClient}>Cancel</button>
          <button class="btn primary" type="submit" ?disabled=${onboardSaving}>
            ${icon(UserPlus, 15)}<span>${onboardSaving ? "Onboarding…" : "Onboard client"}</span>
          </button>
        </div>
      </form>
    </dialog>
  `;
}

function drawClientOverlay(): void {
  if (!overlayEl) {
    overlayEl = document.createElement("div");
    overlayEl.className = "client-overlay";
    document.body.appendChild(overlayEl);
  }
  render(
    html`${toastText ? html`<div class="client-toast" role="status">${toastText}</div>` : nothing}${onboardDialog()}`,
    overlayEl,
  );
  const dialog = overlayEl.querySelector<HTMLDialogElement>(".client-dialog");
  if (dialog && !dialog.open) dialog.showModal();
}
