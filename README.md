# P Cube Charcoal Food Den

Restaurant website, QR table ordering, kitchen display, waiter calls, billing and analytics for
P Cube Charcoal Food Den, Secunderabad. Currency INR (whole rupees), timezone Asia/Kolkata, mobile-first.

Stack: Node 22+, Express 5, built-in SQLite (`node:sqlite`), plain HTML/CSS/JS (no build step).
The only runtime libraries are `express` and `qrcode`.

## Run

```
cd /app
npm install
npm start        # seeds (safe to re-run) and serves on http://localhost:3000
```

Run the seed alone with `npm run seed`. It prints temporary logins **once**, only for users it creates.
If a temporary password is lost for a user who has not yet changed it, reset it with a short script
that sets a new `hashPassword()` value and `must_change_password = 1` on that user.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `data/pcube.db` | SQLite file (back this file up) |
| `PUBLIC_BASE_URL` | request host | Set in production (e.g. `https://yourdomain.in`) so printed QR codes, canonical links and the sitemap use the real domain |
| `TABLE_COUNT` | `6` | Number of tables the seed creates (raise it and re-run the seed to add tables) |

No secrets are stored in the code. Sessions are random tokens (only their SHA-256 hash is stored) and
passwords are hashed with scrypt. Other constants (polling interval, kitchen warning minutes, limits)
are in `server/settings.js`. Colours are in `public/css/theme.css` only (the one exception is
`public/favicon.svg`, because an SVG favicon cannot read CSS variables).

## Roles and screens

| Role | Username | Can use |
|---|---|---|
| owner | `owner` | Everything the manager can, plus `/staff/settings`, and `/kitchen` |
| manager | `manager` | `/staff` (Live, Tables, History), table detail and payment, `/staff/bills`, `/staff/menu`, `/staff/qr`, `/staff/analytics` |
| kitchen | `kitchen` | `/kitchen` only (no prices, cannot accept or cancel, no billing) |
| waiter | `waiter` | `/waiter` only |

Every permission is enforced on the server (the API returns 403), not just hidden in the screens.

### Temporary logins

The seed creates one user per role with a random temporary password, shown once in the console
(`npm run seed`). Each user must change it at first sign-in (`/staff/change-password`).
No passwords are written in this file or in the code.

### Public pages

`/`, `/menu`, `/about`, `/contact`, `/robots.txt`, `/sitemap.xml`, custom 404.
Customers order at `/t/{qr_token}` (the QR code of each table; QR codes are permanent and public).

## Business rules built in

- Statuses: new -> accepted -> preparing -> ready -> served -> completed, plus cancelled. The manager must accept an order before the kitchen sees it. Only staff can cancel.
- The server recalculates all prices; orders store name and price snapshots, so menu edits never change old orders.
- No online payment gateway. Payment is recorded by staff as Cash, UPI or Card.
- Bills are immutable (database triggers); numbered `PC-000001`, `PC-000002`, ...
- Service charge = percent of subtotal; tax = percent of (subtotal + service charge). Both are empty (none) until the owner sets them in Settings.
- Live screens poll every 4 seconds; customer menus refetch every 30 seconds and when the tab regains focus.

## Placeholders still to fill

Stored in the `settings` table (the Settings page edits phone, GSTIN, name, address, tax, service charge;
the rest are edited in the table directly for now):

`[ADD PHONE NUMBER]`, `[ADD WHATSAPP NUMBER]`, `[ADD GSTIN]`, `[ADD TAGLINE]`, `[ADD ABOUT TEXT]`,
`[ADD GOOGLE MAPS LINK]`, `[ADD REVIEWS SOURCE]`, `[ADD LINK]` (Instagram), `[ADD LINK]` (Facebook).
Images: all site and menu pictures are original illustrations in `public/img/art/`. Replace any dish picture with a real photo by pasting its public URL into the item's Image URL in `/staff/menu`.
Also:
the one TBC menu price (Pepper Baby Corn Manchurian) is still "Price to be confirmed" until set in `/staff/menu`.
