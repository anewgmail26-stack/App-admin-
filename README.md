# Nova Tunnel Admin Panel (Static)

এই panel static (`index.html`, `style.css`, `app.js`) এবং Firebase Auth + Firestore দিয়ে কাজ করে।

## Firebase compatibility (App update logic safe)

এই panel ইচ্ছা করে app-এর existing online update structure same রেখেছে:

- Collection: `app_config/main`
- Collection: `servers`
- Collection: `profiles`
- `config_version` increment every write/delete/status-change/settings-save
- `servers` and `profiles` UI fetch by `sort_order` ascending

### Server fields written (same keys)

`server_name, country, flag, protocol, host, port, username, password, sni, status, premium, profile_id, profile_name, sort_order, uuid, alter_id, security, network_type, path, host_header, tls, allow_insecure, flow, public_key, short_id, spider_x, trojan_password, ss_method, ovpn_config`

Payload compatibility fieldsও save হয় (যদি share link দেওয়া হয়):

`payload, config, link, url, shareLink, v2rayLink`

### Profile fields written

`profile_name, icon, country_network, payload, sni, dns_option, status, sort_order`

## Run

1. folder `admin-panel/` open করো
2. Firebase config check করো (`app.js` top)
3. files static host করো (GitHub Pages / Netlify / local server)

## Security note

Production-এ Firestore rules-এ admin-only write enforce করো (UID/custom-claim based)।  
App read-only public/controlled policy তোমার deployment অনুযায়ী set করো।
