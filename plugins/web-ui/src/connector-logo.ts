/// <reference types="vite/client" />
import { html, type TemplateResult } from "lit";
import { Plug } from "lucide";
import { icon } from "./ui";

const CONNECTOR_LOGOS: Record<string, string> = {
  googlecalendar:
    "M18.316 5.684H24v12.632h-5.684V5.684zM5.684 24h12.632v-5.684H5.684V24zM18.316 5.684V0H1.895A1.894 1.894 0 0 0 0 1.895v16.421h5.684V5.684h12.632zm-7.207 6.25v-.065c.272-.144.5-.349.687-.617s.279-.595.279-.982c0-.379-.099-.72-.3-1.025a2.05 2.05 0 0 0-.832-.714 2.703 2.703 0 0 0-1.197-.257c-.6 0-1.094.156-1.481.467-.386.311-.65.671-.793 1.078l1.085.452c.086-.249.224-.461.413-.633.189-.172.445-.257.767-.257.33 0 .602.088.816.264a.86.86 0 0 1 .322.703c0 .33-.12.589-.36.778-.24.19-.535.284-.886.284h-.567v1.085h.633c.407 0 .748.109 1.02.327.272.218.407.499.407.843 0 .336-.129.614-.387.832s-.565.327-.924.327c-.351 0-.651-.103-.897-.311-.248-.208-.422-.502-.521-.881l-1.096.452c.178.616.505 1.082.977 1.401.472.319.984.478 1.538.477a2.84 2.84 0 0 0 1.293-.291c.382-.193.684-.458.902-.794.218-.336.327-.72.327-1.149 0-.429-.115-.797-.344-1.105a2.067 2.067 0 0 0-.881-.689zm2.093-1.931l.602.913L15 10.045v5.744h1.187V8.446h-.827l-2.158 1.557zM22.105 0h-3.289v5.184H24V1.895A1.894 1.894 0 0 0 22.105 0zm-3.289 23.5l4.684-4.684h-4.684V23.5zM0 22.105C0 23.152.848 24 1.895 24h3.289v-5.184H0v3.289z",
  google:
    "M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z",
  linear:
    "M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z",
  dropbox:
    "M6 1.807L0 5.629l6 3.822 6.001-3.822L6 1.807zM18 1.807l-6 3.822 6 3.822 6-3.822-6-3.822zM0 13.274l6 3.822 6.001-3.822L6 9.452l-6 3.822zM18 9.452l-6 3.822 6 3.822 6-3.822-6-3.822zM6 18.371l6.001 3.822 6-3.822-6-3.822L6 18.371z",
  x: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
};

/* Provider marks copied from the Loopfour Studio / docs asset sets; Vite hashes and emits them. */
const LOGO_FILES = Object.fromEntries(
  Object.entries(
    import.meta.glob("./assets/providers/*", { eager: true, query: "?url", import: "default" }) as Record<
      string,
      string
    >,
  ).map(([path, url]) => [/([^/]+)\.[a-z0-9]+$/.exec(path)?.[1] ?? path, url]),
);

/* Composio toolkit ids that don't match a file name after `_` → `-`. */
const LOGO_ALIASES: Record<string, string> = {
  googlesheets: "google-sheets",
  googledrive: "google-drive",
  microsoft_teams: "teams",
  "microsoft-teams": "teams",
};

/* Logos that are already a full tile: they fill the plate edge to edge. */
const FULL_TILE = new Set(["rillet"]);

/* Names the generic title-case rule gets wrong. */
const LOGO_NAMES: Record<string, string> = {
  docusign: "DocuSign",
  github: "GitHub",
  hubspot: "HubSpot",
  netsuite: "NetSuite",
  pandadoc: "PandaDoc",
  quickbooks: "QuickBooks",
  justpaid: "JustPaid",
};

function logoKey(id: string): string {
  return LOGO_ALIASES[id] ?? id.replace(/_/g, "-");
}

/** Display name for a connector / Composio toolkit id. */
export function connectorName(id: string): string {
  const key = logoKey(id);
  return (
    LOGO_NAMES[key] ??
    key
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

/**
 * The provider's own mark on a fixed white plate (DESIGN.md §4.13 app icon tile).
 * `size` is the plate side in px; the logo sits at 62% of it, full-tile logos fill it.
 */
export function connectorLogo(id: string, logoUrl?: string, size = 40): TemplateResult {
  const key = logoKey(id);
  const file = LOGO_FILES[key];
  const style = `--app-icon-size:${size}px`;
  if (file)
    return html`<span
      class=${`connector-logo app-icon${FULL_TILE.has(key) ? " app-icon-full" : ""}`}
      style=${style}
      data-service=${id}
      aria-hidden="true"
      ><img src=${file} alt="" loading="lazy" draggable="false"
    /></span>`;
  const path = CONNECTOR_LOGOS[id];
  const glyph = Math.min(20, Math.max(12, Math.round(size * 0.45)));
  if (!path && logoUrl && /^https:\/\/logos\.composio\.dev\/api\/[a-z0-9_-]{1,100}$/.test(logoUrl)) {
    return html`<span class="connector-logo connector-logo-remote" style=${style} aria-hidden="true"
      >${icon(Plug, glyph)}<img
        src=${logoUrl}
        alt=""
        width=${glyph}
        height=${glyph}
        loading="lazy"
        referrerpolicy="no-referrer"
        @error=${(event: Event) => {
          (event.currentTarget as HTMLImageElement).hidden = true;
        }}
    /></span>`;
  }
  if (!path) return html`<span class="connector-logo" style=${style}>${icon(Plug, glyph)}</span>`;
  return html`<span class="connector-logo" style=${style} data-service=${id}
    ><svg width=${glyph} height=${glyph} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d=${path}></path></svg
  ></span>`;
}
