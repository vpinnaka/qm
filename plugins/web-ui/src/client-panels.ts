import { html, nothing, type TemplateResult } from "lit";
import { Plus, Trash2 } from "lucide";
import { api } from "./core-bridge";
import { errMessage } from "../../chassis/src/errors";
import { connectorLogo } from "./connector-logo";
import { fieldSelect, icon } from "./ui";
import { WEB_PROJECT_SCOPE_PREFIX } from "./deep-link";
import { accountantMode } from "./shell-state";
import { tip } from "./tooltip";

interface McpServerView {
  id: string;
  name: string;
  url: string;
  scopes?: string[];
}

export const clientPanelsState = {
  scope: null as string | null,
  loading: false,
  brief: "",
  briefEditing: false,
  briefDraft: "",
  briefSaving: false,
  briefNotice: "",
  toolkits: [] as string[],
  connectedToolkits: [] as string[],
  appsBusy: false,
  appsNotice: "",
  attachPick: "",
  servers: [] as McpServerView[],
  mcpBusy: false,
  mcpNotice: "",
  mcpName: "",
  mcpUrl: "",
  mcpToken: "",
};

let loadSeq = 0;
let redraw: () => void = () => {};

export function clientPanelsApply(scopeId: string): boolean {
  return accountantMode() && scopeId.startsWith(WEB_PROJECT_SCOPE_PREFIX);
}

export function resetClientPanels(): void {
  loadSeq += 1;
  clientPanelsState.scope = null;
  clientPanelsState.loading = false;
  clientPanelsState.brief = "";
  clientPanelsState.briefEditing = false;
  clientPanelsState.briefDraft = "";
  clientPanelsState.briefSaving = false;
  clientPanelsState.briefNotice = "";
  clientPanelsState.toolkits = [];
  clientPanelsState.connectedToolkits = [];
  clientPanelsState.appsBusy = false;
  clientPanelsState.appsNotice = "";
  clientPanelsState.attachPick = "";
  clientPanelsState.servers = [];
  clientPanelsState.mcpBusy = false;
  clientPanelsState.mcpNotice = "";
  clientPanelsState.mcpName = "";
  clientPanelsState.mcpUrl = "";
  clientPanelsState.mcpToken = "";
}

async function connectedToolkits(): Promise<string[]> {
  const found = new Set<string>();
  let cursor = "";
  for (let page = 0; page < 20; page += 1) {
    const r = await api<{ items?: Array<{ toolkit?: string }>; nextCursor?: string }>(
      `/api/composio/connections?${new URLSearchParams({ cursor })}`,
    );
    for (const item of r.items ?? []) if (typeof item.toolkit === "string" && item.toolkit) found.add(item.toolkit);
    cursor = typeof r.nextCursor === "string" ? r.nextCursor : "";
    if (!cursor) break;
  }
  return [...found].sort();
}

export async function loadClientPanels(scopeId: string, onChange: () => void): Promise<void> {
  redraw = onChange;
  if (!clientPanelsApply(scopeId) || clientPanelsState.scope === scopeId) return;
  resetClientPanels();
  const seq = ++loadSeq;
  clientPanelsState.scope = scopeId;
  clientPanelsState.loading = true;
  const scoped = `scopeId=${encodeURIComponent(scopeId)}`;
  await Promise.all([
    api<{ soul?: string | null }>(`/api/soul?${scoped}`)
      .then((r) => {
        if (seq === loadSeq) clientPanelsState.brief = r.soul ?? "";
      })
      .catch((e: unknown) => {
        if (seq === loadSeq) clientPanelsState.briefNotice = errMessage(e, "Couldn't load this client's brief.");
      }),
    api<{ toolkits?: string[] }>(`/api/scope-apps?${scoped}`)
      .then((r) => {
        if (seq === loadSeq) clientPanelsState.toolkits = r.toolkits ?? [];
      })
      .catch((e: unknown) => {
        if (seq === loadSeq) clientPanelsState.appsNotice = errMessage(e, "Couldn't load this client's apps.");
      }),
    connectedToolkits()
      .then((list) => {
        if (seq === loadSeq) clientPanelsState.connectedToolkits = list;
      })
      .catch(() => undefined),
    api<{ servers?: McpServerView[] }>("/api/mcp-servers")
      .then((r) => {
        if (seq === loadSeq) clientPanelsState.servers = r.servers ?? [];
      })
      .catch((e: unknown) => {
        if (seq === loadSeq) clientPanelsState.mcpNotice = errMessage(e, "Couldn't load this client's integrations.");
      }),
  ]);
  if (seq !== loadSeq) return;
  clientPanelsState.loading = false;
  redraw();
}

async function saveBrief(): Promise<void> {
  const scope = clientPanelsState.scope;
  if (!scope || clientPanelsState.briefSaving) return;
  clientPanelsState.briefSaving = true;
  clientPanelsState.briefNotice = "";
  redraw();
  try {
    await api("/api/soul", {
      method: "POST",
      body: JSON.stringify({ scopeId: scope, content: clientPanelsState.briefDraft }),
    });
    clientPanelsState.brief = clientPanelsState.briefDraft;
    clientPanelsState.briefEditing = false;
    clientPanelsState.briefNotice = "Saved.";
  } catch (e) {
    clientPanelsState.briefNotice = errMessage(e, "Couldn't save the brief. Try again.");
  } finally {
    clientPanelsState.briefSaving = false;
    redraw();
  }
}

async function putToolkits(toolkits: string[]): Promise<void> {
  const scope = clientPanelsState.scope;
  if (!scope || clientPanelsState.appsBusy) return;
  clientPanelsState.appsBusy = true;
  clientPanelsState.appsNotice = "";
  redraw();
  try {
    const r = await api<{ toolkits?: string[] }>("/api/scope-apps", {
      method: "PUT",
      body: JSON.stringify({ scopeId: scope, toolkits }),
    });
    clientPanelsState.toolkits = r.toolkits ?? toolkits;
    clientPanelsState.attachPick = "";
  } catch (e) {
    clientPanelsState.appsNotice = errMessage(e, "Couldn't update this client's apps.");
  } finally {
    clientPanelsState.appsBusy = false;
    redraw();
  }
}

function integrationId(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "tool";
  return `${slug}-${Math.random().toString(36).slice(2, 6)}`;
}

async function addIntegration(): Promise<void> {
  const scope = clientPanelsState.scope;
  const name = clientPanelsState.mcpName.trim();
  const url = clientPanelsState.mcpUrl.trim();
  const token = clientPanelsState.mcpToken.trim();
  if (!scope || clientPanelsState.mcpBusy || !name || !url) return;
  clientPanelsState.mcpBusy = true;
  clientPanelsState.mcpNotice = "";
  redraw();
  try {
    await api(`/api/mcp-servers/${encodeURIComponent(integrationId(name))}`, {
      method: "PUT",
      body: JSON.stringify({
        name,
        url,
        auth: token ? "bearer" : "none",
        ...(token ? { bearerToken: token } : {}),
        enabled: true,
        validate: true,
        scopes: [scope],
      }),
    });
    const r = await api<{ servers?: McpServerView[] }>("/api/mcp-servers");
    clientPanelsState.servers = r.servers ?? [];
    clientPanelsState.mcpName = "";
    clientPanelsState.mcpUrl = "";
    clientPanelsState.mcpToken = "";
  } catch (e) {
    clientPanelsState.mcpNotice = errMessage(e, "Couldn't connect that tool.");
  } finally {
    clientPanelsState.mcpBusy = false;
    redraw();
  }
}

async function removeIntegration(id: string): Promise<void> {
  if (clientPanelsState.mcpBusy) return;
  clientPanelsState.mcpBusy = true;
  clientPanelsState.mcpNotice = "";
  redraw();
  try {
    await api(`/api/mcp-servers/${encodeURIComponent(id)}`, { method: "DELETE" });
    clientPanelsState.servers = clientPanelsState.servers.filter((s) => s.id !== id);
  } catch (e) {
    clientPanelsState.mcpNotice = errMessage(e, "Couldn't remove that tool.");
  } finally {
    clientPanelsState.mcpBusy = false;
    redraw();
  }
}

function briefPanel(): TemplateResult {
  const editing = clientPanelsState.briefEditing;
  return html`
    <section class="context-panel client-brief-panel" aria-labelledby="client-brief-title">
      <div class="context-panel-heading">
        <div>
          <h2 class="context-panel-title" id="client-brief-title">Client brief</h2>
          <p class="context-panel-copy">What the bookkeeper follows on every task for this client.</p>
        </div>
        ${
          editing
            ? nothing
            : html`<button
                class="btn"
                type="button"
                @click=${() => {
                  clientPanelsState.briefEditing = true;
                  clientPanelsState.briefDraft = clientPanelsState.brief;
                  clientPanelsState.briefNotice = "";
                  redraw();
                }}
              >
                Edit brief
              </button>`
        }
      </div>
      ${
        editing
          ? html`<textarea
                class="client-brief-input"
                rows="14"
                aria-label="Client brief"
                .value=${clientPanelsState.briefDraft}
                ?disabled=${clientPanelsState.briefSaving}
                @input=${(e: InputEvent) => {
                  clientPanelsState.briefDraft = (e.currentTarget as HTMLTextAreaElement).value;
                }}
              ></textarea>
              <div class="client-panel-actions">
                <button
                  class="btn primary"
                  type="button"
                  ?disabled=${clientPanelsState.briefSaving}
                  @click=${() => void saveBrief()}
                >
                  ${clientPanelsState.briefSaving ? "Saving…" : "Save brief"}
                </button>
                <button
                  class="btn"
                  type="button"
                  ?disabled=${clientPanelsState.briefSaving}
                  @click=${() => {
                    clientPanelsState.briefEditing = false;
                    redraw();
                  }}
                >
                  Cancel
                </button>
              </div>`
          : clientPanelsState.brief
            ? html`<pre class="client-brief-text" dir="auto">${clientPanelsState.brief}</pre>`
            : html`<div class="context-inline-empty">No brief yet. Add one so the bookkeeper knows this client.</div>`
      }
      ${clientPanelsState.briefNotice ? html`<div class="client-panel-status" aria-live="polite">${clientPanelsState.briefNotice}</div>` : nothing}
    </section>
  `;
}

function appsPanel(): TemplateResult {
  const attached = clientPanelsState.toolkits;
  const available = clientPanelsState.connectedToolkits.filter((t) => !attached.includes(t));
  return html`
    <section class="context-panel client-apps-panel" aria-labelledby="client-apps-title">
      <div class="context-panel-heading">
        <div>
          <h2 class="context-panel-title" id="client-apps-title">Apps</h2>
          <p class="context-panel-copy">The apps the bookkeeper may use for this client.</p>
        </div>
      </div>
      ${
        attached.length
          ? html`<div class="client-app-list">
              ${attached.map(
                (toolkit) =>
                  html`<div class="client-app-row">
                    ${connectorLogo(toolkit)}<span class="client-app-name">${toolkit}</span>
                    <button
                      class="project-icon-button danger"
                      type="button"
                      aria-label=${`Remove ${toolkit} from this client`}
                      ${tip("Remove")}
                      ?disabled=${clientPanelsState.appsBusy}
                      @click=${() => void putToolkits(attached.filter((t) => t !== toolkit))}
                    >
                      ${icon(Trash2, 14)}
                    </button>
                  </div>`,
              )}
            </div>`
          : html`<div class="context-inline-empty">No apps yet for this client.</div>`
      }
      ${
        available.length
          ? html`<div class="client-panel-actions">
              ${fieldSelect({
                compact: true,
                ariaLabel: "App to add",
                disabled: clientPanelsState.appsBusy,
                value: clientPanelsState.attachPick,
                onChange: (value) => {
                  clientPanelsState.attachPick = value;
                },
                options: [
                  html`<option value="">Choose an app…</option>`,
                  ...available.map((t) => html`<option value=${t}>${t}</option>`),
                ],
              })}
              <button
                class="btn"
                type="button"
                ?disabled=${clientPanelsState.appsBusy}
                @click=${() => {
                  const pick = clientPanelsState.attachPick;
                  if (pick) void putToolkits([...attached, pick]);
                }}
              >
                ${icon(Plus, 15)}<span>Add app</span>
              </button>
            </div>`
          : html`<p class="context-panel-copy">Connect an app under Settings first, then add it to this client.</p>`
      }
      ${clientPanelsState.appsNotice ? html`<div class="client-panel-status" aria-live="polite">${clientPanelsState.appsNotice}</div>` : nothing}
    </section>
  `;
}

function integrationsPanel(scopeId: string): TemplateResult {
  const mine = clientPanelsState.servers.filter((s) => (s.scopes ?? []).includes(scopeId));
  return html`
    <section class="context-panel client-mcp-panel" aria-labelledby="client-mcp-title">
      <div class="context-panel-heading">
        <div>
          <h2 class="context-panel-title" id="client-mcp-title">Integrations</h2>
          <p class="context-panel-copy">Connect a tool for this client, e.g. a QuickBooks or Xero MCP server URL.</p>
        </div>
      </div>
      ${
        mine.length
          ? html`<div class="client-app-list">
              ${mine.map(
                (server) =>
                  html`<div class="client-app-row">
                    <span class="client-app-name">${server.name}</span>
                    <span class="client-app-url" dir="auto">${server.url}</span>
                    <button
                      class="project-icon-button danger"
                      type="button"
                      aria-label=${`Remove ${server.name}`}
                      ${tip("Remove")}
                      ?disabled=${clientPanelsState.mcpBusy}
                      @click=${() => void removeIntegration(server.id)}
                    >
                      ${icon(Trash2, 14)}
                    </button>
                  </div>`,
              )}
            </div>`
          : html`<div class="context-inline-empty">No tools connected for this client yet.</div>`
      }
      <form
        class="client-mcp-add"
        @submit=${(e: SubmitEvent) => {
          e.preventDefault();
          void addIntegration();
        }}
      >
        <label class="client-field"
          ><span>Tool name</span>
          <input
            aria-label="Tool name"
            autocomplete="off"
            placeholder="QuickBooks"
            .value=${clientPanelsState.mcpName}
            ?disabled=${clientPanelsState.mcpBusy}
            @input=${(e: InputEvent) => {
              clientPanelsState.mcpName = (e.currentTarget as HTMLInputElement).value;
            }}
          />
        </label>
        <label class="client-field"
          ><span>Server URL</span>
          <input
            aria-label="Server URL"
            autocomplete="off"
            placeholder="https://mcp.example.com/quickbooks"
            .value=${clientPanelsState.mcpUrl}
            ?disabled=${clientPanelsState.mcpBusy}
            @input=${(e: InputEvent) => {
              clientPanelsState.mcpUrl = (e.currentTarget as HTMLInputElement).value;
            }}
          />
        </label>
        <label class="client-field"
          ><span>Access token (optional)</span>
          <input
            type="password"
            aria-label="Access token"
            autocomplete="off"
            .value=${clientPanelsState.mcpToken}
            ?disabled=${clientPanelsState.mcpBusy}
            @input=${(e: InputEvent) => {
              clientPanelsState.mcpToken = (e.currentTarget as HTMLInputElement).value;
            }}
          />
        </label>
        <div class="client-panel-actions">
          <button class="btn" type="submit" ?disabled=${clientPanelsState.mcpBusy}>
            ${icon(Plus, 15)}<span>${clientPanelsState.mcpBusy ? "Connecting…" : "Connect tool"}</span>
          </button>
        </div>
      </form>
      ${clientPanelsState.mcpNotice ? html`<div class="client-panel-status" aria-live="polite">${clientPanelsState.mcpNotice}</div>` : nothing}
    </section>
  `;
}

export function clientPanelsSection(scopeId: string): TemplateResult | typeof nothing {
  if (!clientPanelsApply(scopeId) || clientPanelsState.scope !== scopeId) return nothing;
  if (clientPanelsState.loading)
    return html`<section class="context-panel" aria-label="Client details">
      <div class="context-panel-loading">Loading…</div>
    </section>`;
  return html`${briefPanel()}${appsPanel()}${integrationsPanel(scopeId)}`;
}
