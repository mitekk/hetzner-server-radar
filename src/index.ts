import "dotenv/config";
import { Resend } from "resend";

const API = "https://api.hetzner.cloud/v1/datacenters";
const SERVER_TYPES_API = "https://api.hetzner.cloud/v1/server_types";
const LOCATIONS_API = "https://api.hetzner.cloud/v1/locations";
const EMAIL_FROM = "hetzner.radar@resend.dev";

const DEFAULTS = {
  SERVER_TYPE_ID: 115,
  LOCATION_PREFIX: "nbg1",
  CHECK_INTERVAL_SECONDS: 300,
  EMAIL_COOLDOWN_SECONDS: 3600,
};

interface ServerTypeAvailability {
  supported: number[];
  available: number[];
  available_for_migration: number[];
}

interface Datacenter {
  id: number;
  name: string;
  description: string;
  location: { name: string };
  server_types: ServerTypeAvailability;
}

interface DatacentersResponse {
  datacenters: Datacenter[];
}

interface Config {
  token: string;
  serverTypeId: number;
  locationPrefix: string;
  intervalMs: number;
  cooldownMs: number;
  resendApiKey: string;
  emailTo: string;
}

function die(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(2);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") die(`${name} is not set in .env`);
  return v.trim();
}

function parsePositiveInt(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    die(`${name} must be a positive integer (got "${raw}")`);
  }
  return n;
}

function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function loadConfig(): Config {
  const token = requireEnv("HCLOUD_TOKEN");
  const resendApiKey = requireEnv("RESEND_API_KEY");
  const emailTo = requireEnv("ALERT_EMAIL_TO");

  const serverTypeId = parsePositiveInt(
    "SERVER_TYPE_ID",
    process.env.SERVER_TYPE_ID ?? String(DEFAULTS.SERVER_TYPE_ID),
  );
  const intervalSeconds = parsePositiveInt(
    "CHECK_INTERVAL_SECONDS",
    process.env.CHECK_INTERVAL_SECONDS ??
      String(DEFAULTS.CHECK_INTERVAL_SECONDS),
  );
  const cooldownSeconds = parsePositiveInt(
    "EMAIL_COOLDOWN_SECONDS",
    process.env.EMAIL_COOLDOWN_SECONDS ??
      String(DEFAULTS.EMAIL_COOLDOWN_SECONDS),
  );
  const locationPrefix = (
    process.env.LOCATION_PREFIX ?? DEFAULTS.LOCATION_PREFIX
  ).trim();
  if (!locationPrefix) die("LOCATION_PREFIX must not be empty");

  return {
    token,
    serverTypeId,
    locationPrefix,
    intervalMs: intervalSeconds * 1000,
    cooldownMs: cooldownSeconds * 1000,
    resendApiKey,
    emailTo,
  };
}

async function fetchServerTypeName(
  token: string,
  serverTypeId: number,
): Promise<string> {
  const res = await fetch(`${SERVER_TYPES_API}/${serverTypeId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Hetzner API HTTP ${res.status} fetching server type ${serverTypeId}: ${body.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as { server_type: { name: string } };
  return data.server_type.name;
}

async function fetchLocationLabel(
  token: string,
  locationPrefix: string,
): Promise<string> {
  const res = await fetch(LOCATIONS_API, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Hetzner API HTTP ${res.status} fetching locations: ${body.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as {
    locations: { name: string; city: string }[];
  };
  const cities = Array.from(
    new Set(
      data.locations
        .filter((l) => l.name.startsWith(locationPrefix))
        .map((l) => l.city),
    ),
  );
  if (cities.length === 0) return locationPrefix;
  return cities.join(", ");
}

async function findAvailableDatacenters(
  token: string,
  serverTypeId: number,
  locationPrefix: string,
): Promise<string[]> {
  const res = await fetch(API, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Hetzner API HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as DatacentersResponse;
  return data.datacenters
    .filter((dc) => dc.name.startsWith(locationPrefix))
    .filter((dc) => dc.server_types.available.includes(serverTypeId))
    .map((dc) => dc.name);
}

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

async function sendAlert(
  resend: Resend,
  cfg: Config,
  serverTypeName: string,
  locationLabel: string,
  matches: string[],
): Promise<boolean> {
  const ts = timestamp();
  const subject = `Hetzner: server ${serverTypeName} available in ${locationLabel}`;
  const text = [
    `Server name ${serverTypeName} is currently AVAILABLE in ${locationLabel} datacenters:`,
    "",
    ...matches.map((name) => `  - ${name}`),
    "",
    `Checked at ${ts} UTC.`,
    "",
    "Buy now: https://console.hetzner.cloud/projects",
  ].join("\n");

  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: cfg.emailTo,
    subject,
    text,
  });
  if (error) {
    console.error(`[${timestamp()}] email send failed:`, error);
    return false;
  }
  console.log(`[${timestamp()}] alert email sent to ${cfg.emailTo}`);
  return true;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const resend = new Resend(cfg.resendApiKey);
  const [serverTypeName, locationLabel] = await Promise.all([
    fetchServerTypeName(cfg.token, cfg.serverTypeId),
    fetchLocationLabel(cfg.token, cfg.locationPrefix),
  ]);

  console.log("hetzner-server-radar starting with config:");
  console.log(`  HCLOUD_TOKEN          ${maskToken(cfg.token)}`);
  console.log(`  SERVER_TYPE_ID        ${cfg.serverTypeId} (${serverTypeName})`);
  console.log(`  LOCATION_PREFIX       ${cfg.locationPrefix} (${locationLabel})`);
  console.log(`  CHECK_INTERVAL_SECONDS ${cfg.intervalMs / 1000}`);
  console.log(`  EMAIL_COOLDOWN_SECONDS ${cfg.cooldownMs / 1000}`);
  console.log(`  ALERT_EMAIL_TO        ${cfg.emailTo}`);
  console.log(`  ALERT_EMAIL_FROM      ${EMAIL_FROM}`);

  let inFlight = false;
  let lastAlertAt = 0;
  let wasAvailableLast = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const matches = await findAvailableDatacenters(
        cfg.token,
        cfg.serverTypeId,
        cfg.locationPrefix,
      );
      const ts = timestamp();
      if (matches.length > 0) {
        console.log(
          `[${ts}] server type ${cfg.serverTypeId} AVAILABLE in ${cfg.locationPrefix}: ${matches.join(", ")}`,
        );
        if (!wasAvailableLast) {
          const sinceLast = Date.now() - lastAlertAt;
          if (lastAlertAt === 0 || sinceLast >= cfg.cooldownMs) {
            const sent = await sendAlert(
              resend,
              cfg,
              serverTypeName,
              locationLabel,
              matches,
            );
            if (sent) lastAlertAt = Date.now();
          } else {
            const agoSec = Math.floor(sinceLast / 1000);
            console.log(
              `[${ts}] available again but within cooldown (last alert ${agoSec}s ago) — suppressing`,
            );
          }
        }
        wasAvailableLast = true;
      } else {
        console.log(
          `[${ts}] server type ${cfg.serverTypeId} not available in ${cfg.locationPrefix}`,
        );
        wasAvailableLast = false;
      }
    } catch (err) {
      console.error(`[${timestamp()}] check failed:`, (err as Error).message);
    } finally {
      inFlight = false;
    }
  };

  process.on("SIGINT", () => {
    console.log("\nstopping");
    process.exit(0);
  });

  await tick();
  setInterval(tick, cfg.intervalMs);
}

main().catch((err) => die((err as Error).message));
