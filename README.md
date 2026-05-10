# hetzner-server-radar

Watches Hetzner Cloud for availability of a given server type in a given location and emails when it shows up. Defaults: CX33 (id `115`) in Nuremberg (`nbg1`), checking every 5 minutes.

## Setup

Requires Node 22.

```sh
nvm use            # picks up .nvmrc
npm install
cp .env.example .env
# edit .env and fill in HCLOUD_TOKEN, RESEND_API_KEY, ALERT_EMAIL_TO
npm start
```

## Configuration (`.env`)

| Var                      | Required | Default            | Notes                                         |
| ------------------------ | -------- | ------------------ | --------------------------------------------- |
| `HCLOUD_TOKEN`           | yes      | —                  | Hetzner Cloud API token, read scope is enough |
| `RESEND_API_KEY`         | yes      | —                  | from https://resend.com                       |
| `ALERT_EMAIL_TO`         | yes      | —                  | recipient                                     |
| `SERVER_TYPE_ID`         | no       | `115` (CX33)       | Hetzner server type id                        |
| `LOCATION_PREFIX`        | no       | `nbg1` (Nuremberg) | matches `dc.name.startsWith(...)`             |
| `CHECK_INTERVAL_SECONDS` | no       | `300`              | poll cadence                                  |

### `LOCATION_PREFIX` options

Matches `dc.name.startsWith(...)`, so use the location name (or a specific datacenter name for finer scope). Verified against `GET /v1/datacenters` on 2026-05-10.

| Prefix | City          | Country | Datacenter  |
| ------ | ------------- | ------- | ----------- |
| `nbg1` | Nuremberg     | DE      | `nbg1-dc3`  |
| `fsn1` | Falkenstein   | DE      | `fsn1-dc14` |
| `hel1` | Helsinki      | FI      | `hel1-dc2`  |
| `ash`  | Ashburn, VA   | US      | `ash-dc1`   |
| `hil`  | Hillsboro, OR | US      | `hil-dc1`   |
| `sin`  | Singapore     | SG      | `sin-dc1`   |

### `SERVER_TYPE_ID` options

All active server types from `GET /v1/server_types` (verified 2026-05-10). Specs are cores / memory GB / disk GB.

| ID    | Name  | Specs          | CPU       | Arch |
| ----- | ----- | -------------- | --------- | ---- |
| `22`  | cpx11 | 2 / 2 / 40     | shared    | x86  |
| `23`  | cpx21 | 3 / 4 / 80     | shared    | x86  |
| `24`  | cpx31 | 4 / 8 / 160    | shared    | x86  |
| `25`  | cpx41 | 8 / 16 / 240   | shared    | x86  |
| `26`  | cpx51 | 16 / 32 / 360  | shared    | x86  |
| `45`  | cax11 | 2 / 4 / 40     | shared    | arm  |
| `93`  | cax21 | 4 / 8 / 80     | shared    | arm  |
| `94`  | cax31 | 8 / 16 / 160   | shared    | arm  |
| `95`  | cax41 | 16 / 32 / 320  | shared    | arm  |
| `96`  | ccx13 | 2 / 8 / 80     | dedicated | x86  |
| `97`  | ccx23 | 4 / 16 / 160   | dedicated | x86  |
| `98`  | ccx33 | 8 / 32 / 240   | dedicated | x86  |
| `99`  | ccx43 | 16 / 64 / 360  | dedicated | x86  |
| `100` | ccx53 | 32 / 128 / 600 | dedicated | x86  |
| `101` | ccx63 | 48 / 192 / 960 | dedicated | x86  |
| `108` | cpx12 | 1 / 2 / 40     | shared    | x86  |
| `109` | cpx22 | 2 / 4 / 80     | shared    | x86  |
| `110` | cpx32 | 4 / 8 / 160    | shared    | x86  |
| `111` | cpx42 | 8 / 16 / 320   | shared    | x86  |
| `112` | cpx52 | 12 / 24 / 480  | shared    | x86  |
| `113` | cpx62 | 16 / 32 / 640  | shared    | x86  |
| `114` | cx23  | 2 / 4 / 40     | shared    | x86  |
| `115` | cx33  | 4 / 8 / 80     | shared    | x86  |
| `116` | cx43  | 8 / 16 / 160   | shared    | x86  |
| `117` | cx53  | 16 / 32 / 320  | shared    | x86  |

`93`–`95`, `116`, `117` are listed by the API but not in any datacenter's `available` list at the time of verification — pick one of these only if you're specifically waiting for it to come back in stock.

## How it works

[src/index.ts](src/index.ts) calls `GET https://api.hetzner.cloud/v1/datacenters` every `CHECK_INTERVAL_SECONDS`, filters datacenters whose name starts with `LOCATION_PREFIX` and whose `server_types.available` list contains `SERVER_TYPE_ID`. On any match it logs the matching datacenter names and sends an alert email via Resend. While the server type stays available, an email is sent every cycle.

## Stop

`Ctrl-C`.
