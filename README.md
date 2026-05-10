# Android VPN Admin Panel

Static responsive admin panel for managing VPN app servers, network packs, and app configuration from Firebase Authentication and Cloud Firestore.

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
  server_name: "SERVER - 1",
  country: "Singapore",
  flag: "sg",
  protocol: "V2Ray VLESS",
  host: "example.com",
  port: "443",
  username: "",
  password: "",
  sni: "example.com",
  status: "active",
  premium: false,
  sort_order: 1,
  uuid: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  alter_id: "",
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
  ss_method: ""
}
```

Supported server protocols are `SSH`, `SSL/TLS`, `OVPN`, `V2Ray VMess`, `V2Ray VLESS`, `Trojan`, and `Shadowsocks`. Protocol-specific fields are optional in Firestore and are saved as empty strings or `false` when unused.

### `profiles/{profileId}`

```js
{
  profile_name: "YouTube Pack Bypass",
  icon: "youtube",
  country_network: "BD Network",
  payload: "payload text",
  sni: "example.com",
  dns_option: false,
  status: "active",
  sort_order: 1
}
```

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
