# Android VPN Admin Panel

Static responsive admin panel for managing VPN app servers, network packs, and app configuration from Firebase Authentication and Cloud Firestore.

The admin UI is split into protocol sections:

- Dashboard
- V2Ray Servers
- SSH Servers
- OpenVPN Servers
- Trojan / Shadowsocks
- Profiles / Packs
- Settings

## Files

- `index.html`
- `style.css`
- `app.js`
- `README.md`

No PHP, MySQL, Node backend, React, build tools, npm, or Firebase Hosting are required.

## Hosting on GitHub Pages

1. Create a GitHub repository.
2. Upload these four files to the repository root.
3. Open repository `Settings`.
4. Go to `Pages`.
5. Set source to your main branch and root folder.
6. Open the GitHub Pages URL after deployment finishes.

## Firebase Setup

This panel uses:

- Firebase Authentication Email/Password login
- Cloud Firestore read/write
- Firebase Web SDK module imports from Google's CDN

Email/Password sign-in must be enabled in Firebase Authentication. Create your admin user in the Firebase Console. Do not place any admin password in this code.

## Firestore Data Structure

### `app_config/main`

```js
{
  config_version: 1,
  app_notice: "Welcome",
  force_update: false,
  minimum_app_version: "1.0.0"
}
```

### `servers/{serverId}`

```js
{
  name: "Singapore Server 01",
  server_name: "SERVER - 1",
  profileId: "youtube_pack_bypass",
  profile_id: "youtube_pack_bypass",
  profile_name: "YouTube Pack Bypass",
  country: "Singapore",
  flagCode: "SG",
  flag: "sg",
  imageUrl: "",
  active: true,
  order: 1,
  payload: "",
  dns_option: false,
  proxy: "",
  user: "",
  ssl_port: "",
  ssh_port: "",
  udp_port: "",
  protocol: "V2Ray VLESS",
  host: "example.com",
  port: 443,
  username: "",
  password: "",
  sni: "example.com",
  status: "active",
  premium: false,
  sort_order: 1,
  uuid: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  alter_id: 0,
  security: "tls",
  network_type: "ws",
  path: "/path",
  host_header: "example.com",
  tls: true,
  allow_insecure: false,
  flow: "",
  public_key: "",
  short_id: "",
  spider_x: "",
  trojan_password: "",
  ss_method: "",
  ovpn_config: "",
  createdAt: "...",
  updatedAt: "..."
}
```

Supported server protocols are `SSH`, `OVPN`, `OpenVPN`, `V2Ray VMess`, `V2Ray VLESS`, `Trojan`, and `Shadowsocks`. Protocol-specific fields are optional in Firestore and are saved as empty strings, `0`, or `false` when unused.

The V2Ray section can import `vmess://` and `vless://` links. Parsed values are loaded into the editable V2Ray form first, and Firestore is updated only after clicking save.

The OpenVPN section can parse pasted `.ovpn` config text. It saves the full text in `ovpn_config` and tries to extract the first `remote host port` line for manual review.

Server cards mask sensitive values such as UUIDs and passwords. Full values are loaded only when editing a server.

## Linking Servers to Profiles

Every server form includes a required `Linked Profile / Pack` dropdown. The dropdown is loaded from the `profiles` collection and shows only active profiles. Each option is displayed as:

```text
Profile Name
```

When a server is saved, the selected profile is stored in the server document:

```js
{
  profileId: "youtube_pack_bypass",
  profile_id: "youtube_pack_bypass",
  profile_name: "Profile Name"
}
```

Servers cannot be saved without a selected profile. If a linked profile is deleted later, the admin panel keeps working and shows `Profile missing` on affected server cards.

The Android app can use `profileId` later to group or filter servers by pack. `profile_id` is also saved for backward compatibility with earlier admin-panel data, and `profile_name` is saved as a convenient display fallback.

### `profiles/{profileId}`

```js
{
  profileId: "youtube_pack_bypass",
  name: "YouTube Pack Bypass",
  imageUrl: "https://example.com/youtube.png",
  active: true,
  order: 1,
  createdAt: "...",
  updatedAt: "...",
  profile_name: "YouTube Pack Bypass",
  icon: "youtube",
  status: "active",
  sort_order: 1
}
```

The profile form is only for pack/category metadata: Profile Name, Profile Image URL, Icon, Active, and Order. Server connection fields such as payload, SNI, DNS, host, port, username, and password are saved only on server documents.

## Config Version Logic

The panel increases `app_config/main/config_version` by `1` whenever:

- A server is added, edited, deleted, enabled, disabled, or changed between free/premium
- A profile is added, edited, deleted, enabled, or disabled
- App settings are saved
- The manual `Increase Version` button is clicked

The increment uses a Firestore transaction with `increment(1)`.

## Android App Fetching

Your Android VPN app can fetch:

- `app_config/main` to check `config_version`, `app_notice`, `force_update`, and `minimum_app_version`
- `servers` ordered by `sort_order`
- `profiles` ordered by `sort_order`

Only display documents where:

```js
status == "active"
```

Keep the field names exactly as shown above so the Android app can parse the data consistently.

## Security Warning

Firebase web config values are okay to be public in web apps. They identify your Firebase project, but they are not admin credentials.

Your admin password must never be placed in HTML, CSS, JavaScript, GitHub, or the Android app.

Before production, update Firestore security rules. Without strong rules, other users may be able to read or write data in ways you do not want.

## Firestore Rules Option 1: Public Read, Authenticated Admin Write

Use this if your Android app fetches config, servers, and profiles without user login.

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /app_config/{document} {
      allow read: if true;
      allow write: if request.auth != null;
    }

    match /servers/{document} {
      allow read: if true;
      allow write: if request.auth != null;
    }

    match /profiles/{document} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

Important: authenticated write means any signed-in Firebase Auth user can write. For stronger admin-only security, add custom claims or restrict by admin UID.

## Firestore Rules Option 2: Authenticated Read and Write Only

Use this if your Android app also signs in before fetching config.

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /app_config/{document} {
      allow read, write: if request.auth != null;
    }

    match /servers/{document} {
      allow read, write: if request.auth != null;
    }

    match /profiles/{document} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## Stronger Admin-Only Write Example

Replace `YOUR_ADMIN_UID` with the Firebase Authentication UID of your admin account.

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return request.auth != null && request.auth.uid == "YOUR_ADMIN_UID";
    }

    match /app_config/{document} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /servers/{document} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /profiles/{document} {
      allow read: if true;
      allow write: if isAdmin();
    }
  }
}
```
