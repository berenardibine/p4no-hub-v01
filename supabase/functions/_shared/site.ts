// Single source of truth for the public site URL in Edge Functions.
// Set the SITE_URL secret to move to a new domain.
export const SITE_URL: string = (
  Deno.env.get("SITE_URL") || Deno.env.get("OG_SITE_URL") || "https://p4nohub.online"
).replace(/\/+$/, "");
