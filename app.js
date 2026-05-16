import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA53ff_1_jHgJnv8mpOrV60-YAkYEziGNw",
  authDomain: "my-vpn-admin.firebaseapp.com",
  projectId: "my-vpn-admin",
  storageBucket: "my-vpn-admin.firebasestorage.app",
  messagingSenderId: "905648048611",
  appId: "1:905648048611:web:801236a9cc830c1914f8d6",
  measurementId: "G-RXJC2MMF43"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const configRef = doc(db, "app_config", "main");

const state = {
  servers: [],
  profiles: [],
  config: {
    config_version: 0,
    app_notice: "",
    force_update: false,
    minimum_app_version: ""
  }
};

const $ = (id) => document.getElementById(id);
const serverCollections = collection(db, "servers");

const els = {
  toast: $("toast"),
  loginScreen: $("loginScreen"),
  adminApp: $("adminApp"),
  loadingBar: $("loadingBar"),
  loginForm: $("loginForm"),
  loginButton: $("loginButton"),
  logoutButton: $("logoutButton"),
  refreshButton: $("refreshButton"),
  userEmail: $("userEmail"),
  screenTitle: $("screenTitle"),
  profilesList: $("profilesList"),
  profileSearch: $("profileSearch")
};

const screenTitles = {
  dashboardScreen: "Dashboard",
  v2rayScreen: "V2Ray Servers",
  sshScreen: "SSH Servers",
  ovpnScreen: "OpenVPN Servers",
  trojanScreen: "Trojan / Shadowsocks",
  profilesScreen: "Profiles / Packs",
  settingsScreen: "App Settings"
};

const protocolScreens = {
  "V2Ray VMess": "v2rayScreen",
  "V2Ray VLESS": "v2rayScreen",
  VLESS: "v2rayScreen",
  VMESS: "v2rayScreen",
  SSH: "sshScreen",
  OVPN: "ovpnScreen",
  OpenVPN: "ovpnScreen",
  "Imported OpenVPN": "ovpnScreen",
  Trojan: "trojanScreen",
  TROJAN: "trojanScreen",
  Shadowsocks: "trojanScreen",
  SHADOWSOCKS: "trojanScreen"
};

const OVPN_MODES_WITH_PAYLOAD = ["PAYLOAD", "PAYLOAD_PROXY", "SSL_PAYLOAD"];
const OVPN_MODES_WITH_SSL = ["SSL", "SSL_PAYLOAD"];

function showToast(message, type = "success") {
  els.toast.textContent = message;
  els.toast.className = `toast show ${type === "error" ? "error" : ""}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.className = "toast";
  }, 4200);
}

function setLoading(isLoading) {
  els.loadingBar.classList.toggle("hidden", !isLoading);
}

function setButtonLoading(button, isLoading, label) {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function firebaseMessage(error) {
  return error?.message?.replace("Firebase: ", "") || error?.message || "Something went wrong.";
}

function safeId(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumberValue(id) {
  const value = fieldValue(id);
  return value === "" ? "" : numberValue(value);
}

function isOvpnProtocol(protocol) {
  return ["OVPN", "OpenVPN", "Imported OpenVPN"].includes(protocol);
}

function isV2rayProtocol(protocol) {
  return ["VLESS", "VMESS", "V2Ray VLESS", "V2Ray VMess"].includes(protocol);
}

function isTrojanProtocol(protocol) {
  return ["TROJAN", "Trojan"].includes(protocol);
}

function isShadowsocksProtocol(protocol) {
  return ["SHADOWSOCKS", "Shadowsocks"].includes(protocol);
}

function boolValue(id) {
  return $(id).value === "true";
}

function fieldValue(id) {
  const element = $(id);
  return element ? element.value.trim() : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function maskSecret(value) {
  const text = String(value || "");
  if (!text) return "empty";
  if (text.length <= 10) return `${text.slice(0, 3)}...`;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function profileIdOf(profile) {
  return profile.profileId || profile.id || "";
}

function profileNameOf(profile) {
  return profile.name || profile.profile_name || "Unnamed Profile";
}

function profileIsActive(profile) {
  if (typeof profile.active === "boolean") return profile.active;
  return (profile.status || "active") === "active";
}

function serverNameOf(server) {
  return server.name || server.server_name || "Unnamed Server";
}

function serverFlagOf(server) {
  return server.flagCode || server.flag || "";
}

async function ensureConfig() {
  const snapshot = await getDoc(configRef);
  if (snapshot.exists()) return snapshot.data();

  const defaultConfig = {
    config_version: 0,
    app_notice: "",
    force_update: false,
    minimum_app_version: "",
    updated_at: serverTimestamp()
  };
  await setDoc(configRef, defaultConfig);
  return defaultConfig;
}

async function bumpConfigVersion(transaction) {
  transaction.set(
    configRef,
    {
      config_version: increment(1),
      updated_at: serverTimestamp()
    },
    { merge: true }
  );
}

async function writeWithVersion(writeAction) {
  await runTransaction(db, async (transaction) => {
    await writeAction(transaction);
    await bumpConfigVersion(transaction);
  });
  await loadAllData();
}

async function loadAllData() {
  setLoading(true);
  try {
    const [configData, serverSnapshot, profileSnapshot] = await Promise.all([
      ensureConfig(),
      getDocs(query(collection(db, "servers"), orderBy("sort_order", "asc"))),
      getDocs(query(collection(db, "profiles"), orderBy("sort_order", "asc")))
    ]);

    state.config = {
      config_version: numberValue(configData.config_version),
      app_notice: configData.app_notice || "",
      force_update: Boolean(configData.force_update),
      minimum_app_version: configData.minimum_app_version || ""
    };
    state.servers = serverSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    state.profiles = profileSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

    renderDashboard();
    renderProfileDropdowns();
    renderAllServerLists();
    renderProfiles();
    renderSettings();
  } catch (error) {
    showToast(firebaseMessage(error), "error");
  } finally {
    setLoading(false);
  }
}

function renderDashboard() {
  $("dashConfigVersion").textContent = state.config.config_version;
  $("dashActiveServers").textContent = state.servers.filter((server) => server.status === "active").length;
  $("dashTotalProfiles").textContent = state.profiles.length;
  $("dashNotice").textContent = state.config.app_notice || "No notice set.";
}

function renderSettings() {
  $("settingsNotice").value = state.config.app_notice;
  $("settingsForceUpdate").value = String(state.config.force_update);
  $("settingsMinimumVersion").value = state.config.minimum_app_version;
  $("settingsConfigVersion").value = state.config.config_version;
}

function baseServerData(prefix, protocol) {
  const linkedProfile = getSelectedProfile(prefix);
  const serverName = $(`${prefix}Name`).value.trim();
  const flagCode = $(`${prefix}Flag`).value.trim();
  const status = $(`${prefix}Status`).value;
  const sortOrder = numberValue($(`${prefix}SortOrder`).value);

  return {
    server_name: serverName,
    name: serverName,
    country: $(`${prefix}Country`).value.trim(),
    flag: flagCode,
    flagCode,
    imageUrl: fieldValue(`${prefix}ImageUrl`),
    ping: fieldValue(`${prefix}Ping`),
    payload: fieldValue(`${prefix}Payload`),
    dns_option: $(`${prefix}Dns`) ? boolValue(`${prefix}Dns`) : false,
    dns: $(`${prefix}Dns`) && boolValue(`${prefix}Dns`) ? "on" : "off",
    proxy: fieldValue(`${prefix}Proxy`),
    user: fieldValue(`${prefix}User`),
    ssl_port: optionalNumberValue(`${prefix}SslPort`),
    ssh_port: optionalNumberValue(`${prefix}SshPort`),
    udp_port: optionalNumberValue(`${prefix}UdpPort`),
    protocol,
    host: $(`${prefix}Host`).value.trim(),
    port: numberValue($(`${prefix}Port`).value),
    username: "",
    password: "",
    sni: "",
    status,
    active: status === "active",
    premium: boolValue(`${prefix}Premium`),
    access: boolValue(`${prefix}Premium`) ? "Premium" : "Free",
    profile_id: linkedProfile.id,
    profile_name: linkedProfile.name,
    profileId: linkedProfile.id,
    linkedProfile: linkedProfile.id,
    sort_order: sortOrder,
    order: sortOrder,
    uuid: "",
    alter_id: 0,
    security: "",
    network_type: "",
    path: "",
    host_header: "",
    tls: false,
    allow_insecure: false,
    flow: "",
    encryption: "",
    alpn: "",
    fingerprint: "",
    fp: "",
    serviceName: "",
    public_key: "",
    pbk: "",
    short_id: "",
    sid: "",
    spider_x: "",
    spx: "",
    trojan_password: "",
    ss_method: "",
    pluginMode: "",
    pluginOptions: "",
    ovpn_config: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updated_at: serverTimestamp()
  };
}

function getSelectedProfile(prefix) {
  const select = $(`${prefix}Profile`);
  const profileId = select.value;
  if (!profileId) return { id: "", name: "" };

  const profile = state.profiles.find((item) => profileIdOf(item) === profileId || item.id === profileId);
  if (profile) {
    return {
      id: profileIdOf(profile),
      name: profileNameOf(profile)
    };
  }

  const selectedOption = select.options[select.selectedIndex];
  return {
    id: profileId,
    name: selectedOption?.dataset.profileName || ""
  };
}

function renderProfileDropdowns() {
  ["v2ray", "ssh", "ovpn", "trojan", "ss"].forEach((prefix) => {
    const select = $(`${prefix}Profile`);
    const selectedValue = select.value;
    select.innerHTML = '<option value="">Select Profile</option>';

    state.profiles.filter(profileIsActive).forEach((profile) => {
      const option = document.createElement("option");
      option.value = profileIdOf(profile);
      option.dataset.profileName = profileNameOf(profile);
      option.textContent = profileNameOf(profile);
      select.appendChild(option);
    });

    if (selectedValue) select.value = selectedValue;
  });
}

function setLinkedProfileValue(prefix, server) {
  const select = $(`${prefix}Profile`);
  const profileId = server.profileId || server.profile_id || "";

  const hasOption = Array.from(select.options).some((option) => option.value === profileId);
  if (profileId && !hasOption) {
    const option = document.createElement("option");
    option.value = profileId;
    option.dataset.profileName = server.profile_name || "";
    option.textContent = server.profile_name ? `${server.profile_name} — Profile missing` : "Profile missing";
    select.appendChild(option);
  }

  select.value = profileId;
}

function validateRequired(data, fields, message) {
  const missing = fields.some((field) => data[field] === "" || data[field] === 0 || data[field] == null);
  if (missing) throw new Error(message);
}

function validateServerProfile(data) {
  if (!data.profileId) throw new Error("Select Profile is required before saving a server.");
}

function v2rayPayload() {
  const protocol = $("v2rayProtocol").value;
  const data = baseServerData("v2ray", protocol);
  if (!isV2rayProtocol(protocol)) {
    throw new Error("Use the matching SSH, TROJAN, SHADOWSOCKS, or OVPN section to save that protocol.");
  }
  data.uuid = $("v2rayUuid").value.trim();
  data.alter_id = numberValue($("v2rayAlterId").value);
  data.encryption = $("v2rayEncryption").value.trim() || (protocol === "VLESS" ? "none" : "");
  data.security = $("v2raySecurity").value.trim();
  data.network_type = $("v2rayNetworkType").value.trim();
  data.path = $("v2rayPath").value.trim();
  data.host_header = $("v2rayHostHeader").value.trim();
  data.sni = $("v2raySni").value.trim();
  data.tls = boolValue("v2rayTls");
  data.allow_insecure = boolValue("v2rayAllowInsecure");
  data.alpn = $("v2rayAlpn").value.trim();
  data.fingerprint = $("v2rayFingerprint").value.trim();
  data.fp = data.fingerprint;
  data.serviceName = $("v2rayServiceName").value.trim();
  data.flow = $("v2rayFlow").value.trim();
  data.public_key = $("v2rayPublicKey").value.trim();
  data.pbk = data.public_key;
  data.short_id = $("v2rayShortId").value.trim();
  data.sid = data.short_id;
  data.spider_x = $("v2raySpiderX").value.trim();
  data.spx = data.spider_x;
  validateRequired(data, ["server_name", "protocol", "host", "port", "uuid", "status"], "VLESS/VMESS requires Server Name, Protocol, Host/IP, Port, UUID/ID, Status, and Sort Order.");
  if (protocol === "VLESS" && !data.encryption) throw new Error("VLESS requires Encryption. Use none if unsure.");
  if (data.security.toLowerCase() === "reality" && !data.public_key) throw new Error("Public Key is required for Reality.");
  validateServerProfile(data);
  if ($("v2raySortOrder").value === "") throw new Error("V2Ray requires Sort Order.");
  return data;
}

function sshPayload() {
  const protocol = $("sshProtocol").value;
  const data = baseServerData("ssh", protocol);
  if (protocol !== "SSH") {
    throw new Error("Use the matching VLESS, VMESS, TROJAN, SHADOWSOCKS, or OVPN section to save that protocol.");
  }
  data.username = $("sshUsername").value.trim();
  data.password = $("sshPassword").value.trim();
  data.sni = $("sshSni").value.trim();
  data.sslHost = $("sshSslHost").value.trim();
  data.tlsVersion = $("sshTlsVersion").value.trim();
  data.verifySsl = boolValue("sshVerifySsl");
  data.allowInsecure = boolValue("sshAllowInsecure");
  data.ssh_port = data.port;
  validateRequired(data, ["server_name", "host", "port", "username", "password", "status"], "SSH requires Server Name, Host/IP, Port, Username, Password, Status, and Sort Order.");
  validateServerProfile(data);
  if ($("sshSortOrder").value === "") throw new Error("SSH requires Sort Order.");
  return data;
}

function ovpnPayload() {
  const protocol = $("ovpnProtocol").value;
  const data = baseServerData("ovpn", protocol);
  const ovpnMode = $("ovpnMode").value || "NORMAL";
  const existingId = $("ovpnDocId").value.trim();
  const existingServer = state.servers.find((server) => server.id === existingId);
  const passwordValue = $("ovpnPassword").value;
  const proxyPasswordValue = $("ovpnProxyPassword").value;
  const ovpnConfigText = $("ovpnConfigText").value.trim();
  const ovpnConfigUrl = $("ovpnConfigUrl").value.trim();

  data.username = $("ovpnUsername").value.trim();
  data.password = passwordValue ? passwordValue : existingServer?.password || "";
  data.sni = $("ovpnSni").value.trim();
  data.ping = $("ovpnPing").value.trim();
  data.protocol = isOvpnProtocol(protocol) ? "OVPN" : protocol;
  data.ovpnMode = ovpnMode;
  data.ovpnConfigText = ovpnConfigText;
  data.ovpnConfigUrl = ovpnConfigUrl;
  data.ovpn_config = ovpnConfigText;
  data.payload = $("ovpnPayload").value.trim();
  data.payloadHost = $("ovpnPayloadHost").value.trim();
  data.payloadPort = $("ovpnPayloadPort").value.trim();
  data.payloadMethod = $("ovpnPayloadMethod").value.trim();
  data.payloadHeaders = $("ovpnPayloadHeaders").value.trim();
  data.proxyHost = $("ovpnProxyHost").value.trim();
  data.proxyPort = $("ovpnProxyPort").value.trim();
  data.proxyUsername = $("ovpnProxyUsername").value.trim();
  data.proxyPassword = proxyPasswordValue ? proxyPasswordValue : existingServer?.proxyPassword || "";
  data.sniHost = $("ovpnSniHost").value.trim() || $("ovpnSslHost").value.trim();
  data.sslHost = "";
  data.tlsVersion = $("ovpnTlsVersion").value.trim();
  data.verifySsl = boolValue("ovpnVerifySsl");
  data.allowInsecure = boolValue("ovpnAllowInsecure");

  if (!isOvpnProtocol(protocol)) {
    throw new Error("Use the matching SSH, VLESS, TROJAN, or SHADOWSOCKS section to save that protocol.");
  }

  if (!data.server_name || !data.status || $("ovpnSortOrder").value === "") {
    throw new Error("OpenVPN requires Server Name, Status, and Sort Order.");
  }

  if (isOvpnProtocol(protocol)) {
    if (!ovpnConfigText && !ovpnConfigUrl) {
      throw new Error("OpenVPN config is required");
    }
    if (ovpnConfigUrl) {
      const lowerUrl = ovpnConfigUrl.toLowerCase();
      if (lowerUrl.includes("github.com/") && lowerUrl.includes("/blob/")) {
        throw new Error("OVPN Config URL must be a direct raw .ovpn link, not a GitHub blob link.");
      }
      if (!lowerUrl.includes(".ovpn")) {
        throw new Error("OVPN Config URL should be a direct raw .ovpn link.");
      }
    }
    if (OVPN_MODES_WITH_PAYLOAD.includes(ovpnMode) && !data.payload) {
      throw new Error("Payload is required for this OpenVPN mode");
    }
    if (ovpnMode === "PAYLOAD_PROXY" && (!data.proxyHost || !data.proxyPort)) {
      throw new Error("Proxy host and port are required");
    }
    if (OVPN_MODES_WITH_SSL.includes(ovpnMode) && !data.sniHost) {
      throw new Error("SNI Host is required");
    }
  }

  validateServerProfile(data);
  return data;
}

function trojanPayload() {
  const protocol = $("trojanProtocol").value;
  const data = baseServerData("trojan", protocol);
  if (protocol !== "TROJAN") {
    throw new Error("Use the matching SSH, VLESS, VMESS, SHADOWSOCKS, or OVPN section to save that protocol.");
  }
  data.trojan_password = $("trojanPassword").value.trim();
  data.password = data.trojan_password;
  data.sni = $("trojanSni").value.trim();
  data.network_type = $("trojanNetworkType").value.trim();
  data.host_header = $("trojanHostHeader").value.trim();
  data.path = $("trojanPath").value.trim();
  data.alpn = $("trojanAlpn").value.trim();
  data.serviceName = $("trojanServiceName").value.trim();
  data.tls = boolValue("trojanTls");
  data.tlsVersion = $("trojanTlsVersion").value.trim();
  data.allowInsecure = boolValue("trojanAllowInsecure");
  validateRequired(data, ["server_name", "host", "port", "trojan_password", "status"], "Trojan requires Server Name, Host/IP, Port, Trojan Password, Status, and Sort Order.");
  validateServerProfile(data);
  if ($("trojanSortOrder").value === "") throw new Error("Trojan requires Sort Order.");
  return data;
}

function ssPayload() {
  const protocol = $("ssProtocol").value;
  const data = baseServerData("ss", protocol);
  data.ss_method = $("ssMethod").value.trim();
  data.password = $("ssPassword").value.trim();
  data.sni = $("ssSni").value.trim();
  data.pluginMode = $("ssPluginMode").value.trim();
  data.pluginOptions = $("ssPluginOptions").value.trim();
  data.host_header = $("ssHostHeader").value.trim();
  data.path = $("ssPath").value.trim();
  data.tls = boolValue("ssTls");
  validateRequired(data, ["server_name", "host", "port", "ss_method", "password", "status"], "Shadowsocks requires Server Name, Host/IP, Port, Method, Password, Status, and Sort Order.");
  validateServerProfile(data);
  if ($("ssSortOrder").value === "") throw new Error("Shadowsocks requires Sort Order.");
  return data;
}

async function saveServerFromForm(prefix, payloadFactory, buttonId, resetFn, successMessage) {
  const button = $(buttonId);
  setButtonLoading(button, true, "Saving...");
  try {
    const existingId = $(`${prefix}DocId`).value.trim();
    const customId = safeId($(`${prefix}CustomId`).value);
    const data = payloadFactory();
    if (existingId) delete data.createdAt;
    const targetRef = existingId
      ? doc(db, "servers", existingId)
      : customId
        ? doc(db, "servers", customId)
        : doc(serverCollections);

    await writeWithVersion(async (transaction) => {
      transaction.set(targetRef, data, { merge: Boolean(existingId) });
    });

    resetFn();
    showToast(successMessage);
  } catch (error) {
    showToast(firebaseMessage(error), "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function renderAllServerLists() {
  renderServerList("v2rayList", "v2raySearch", (server) => isV2rayProtocol(server.protocol));
  renderServerList("sshList", "sshSearch", (server) => server.protocol === "SSH");
  renderServerList("ovpnList", "ovpnSearch", (server) => isOvpnProtocol(server.protocol));
  renderServerList("trojanList", "trojanSearch", (server) => isTrojanProtocol(server.protocol) || isShadowsocksProtocol(server.protocol));
}

function renderServerList(listId, searchId, filterFn) {
  const list = $(listId);
  const term = $(searchId).value.trim().toLowerCase();
  const filtered = state.servers.filter(filterFn).filter((server) => {
    return `${server.server_name || ""} ${server.country || ""} ${server.host || ""}`.toLowerCase().includes(term);
  });

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">No servers found.</div>';
    return;
  }

  list.innerHTML = filtered.map((server) => serverCard(server)).join("");
}

function serverCard(server) {
  const secretBadge = sensitiveBadge(server);
  const linkedProfile = linkedProfileLabel(server);
  const media = server.imageUrl
    ? `<img class="item-media" src="${escapeAttr(server.imageUrl)}" alt="">`
    : `<span class="flag-fallback">${escapeHtml(serverFlagOf(server) || "--")}</span>`;
  return `
    <article class="item-card">
      <div class="item-card-header">
        ${media}
        <div>
          <h4 class="item-title">${escapeHtml(serverNameOf(server))}</h4>
          <p class="item-subtitle">${escapeHtml(server.country || "No country")} - ${escapeHtml(serverFlagOf(server) || "No flag")} - ${escapeHtml(server.host || "No host")}:${escapeHtml(server.port || "")}</p>
        </div>
        <span class="badge ${server.active || server.status === "active" ? "" : "inactive"}">${server.active || server.status === "active" ? "active" : "inactive"}</span>
      </div>
      <div class="badge-row">
        <span class="badge">${escapeHtml(protocolSummary(server))}</span>
        <span class="badge">${server.premium ? "Premium" : "Free"}</span>
        <span class="badge">Sort ${numberValue(server.sort_order)}</span>
        ${server.ping ? `<span class="badge">${escapeHtml(server.ping)}</span>` : ""}
        ${secretBadge}
      </div>
      <p class="item-subtitle">Linked Profile: ${escapeHtml(linkedProfile)}</p>
      <div class="item-actions">
        <button class="secondary-btn" data-action="edit-server" data-id="${escapeAttr(server.id)}" type="button">Edit</button>
        <button class="ghost-btn" data-action="duplicate-server" data-id="${escapeAttr(server.id)}" type="button">Duplicate</button>
        <button class="ghost-btn" data-action="toggle-server-status" data-id="${escapeAttr(server.id)}" type="button">${server.status === "active" ? "Disable" : "Enable"}</button>
        <button class="danger-btn" data-action="delete-server" data-id="${escapeAttr(server.id)}" type="button">Delete</button>
      </div>
    </article>
  `;
}

function linkedProfileLabel(server) {
  const profileId = server.profileId || server.profile_id || "";
  if (!profileId && !server.profile_name) return "None";
  const profile = state.profiles.find((item) => profileIdOf(item) === profileId || item.id === profileId);
  if (profile) return profileNameOf(profile);
  if (profileId) return "Profile missing";
  return server.profile_name || "None";
}

function protocolSummary(server) {
  const protocol = server.protocol || "protocol";
  const network = (server.network_type || "").toUpperCase();
  const secure = server.tls || ["tls", "reality"].includes(String(server.security || "").toLowerCase());
  if (isOvpnProtocol(protocol)) return `OVPN ${server.ovpnMode || "NORMAL"}`;
  if (isV2rayProtocol(protocol)) return [protocol, network, secure ? String(server.security || "TLS").toUpperCase() : ""].filter(Boolean).join(" ");
  if (isTrojanProtocol(protocol)) return ["TROJAN", network, secure ? "TLS" : ""].filter(Boolean).join(" ");
  if (isShadowsocksProtocol(protocol)) return "SHADOWSOCKS";
  return protocol;
}

function sensitiveBadge(server) {
  if (isOvpnProtocol(server.protocol)) {
    return `
      <span class="badge">${escapeHtml(server.ovpnMode || "NORMAL")}</span>
      <span class="badge">Config ${server.ovpnConfigText || server.ovpn_config ? "Text" : server.ovpnConfigUrl ? "URL" : "Missing"}</span>
    `;
  }
  if (isV2rayProtocol(server.protocol)) {
    return `
      <span class="badge">UUID ${escapeHtml(maskSecret(server.uuid))}</span>
      <span class="badge">Net ${escapeHtml(server.network_type || "none")}</span>
      <span class="badge">TLS ${server.tls ? "On" : "Off"}</span>
    `;
  }
  if (isTrojanProtocol(server.protocol)) return `<span class="badge">Password ${escapeHtml(maskSecret(server.trojan_password || server.password))}</span>`;
  if (isShadowsocksProtocol(server.protocol)) return `<span class="badge">${escapeHtml(server.ss_method || "method")}</span>`;
  return server.username ? `<span class="badge">User ${escapeHtml(server.username)}</span>` : "";
}

function setCommon(prefix, server) {
  $(`${prefix}DocId`).value = server.id || "";
  $(`${prefix}CustomId`).value = server.id || "";
  $(`${prefix}CustomId`).disabled = Boolean(server.id);
  $(`${prefix}Name`).value = serverNameOf(server);
  $(`${prefix}Country`).value = server.country || "";
  $(`${prefix}Flag`).value = serverFlagOf(server);
  if ($(`${prefix}ImageUrl`)) $(`${prefix}ImageUrl`).value = server.imageUrl || "";
  if ($(`${prefix}Ping`)) $(`${prefix}Ping`).value = server.ping || "";
  if ($(`${prefix}Payload`)) $(`${prefix}Payload`).value = server.payload || "";
  if ($(`${prefix}Dns`)) $(`${prefix}Dns`).value = String(Boolean(server.dns_option));
  if ($(`${prefix}Proxy`)) $(`${prefix}Proxy`).value = server.proxy || "";
  if ($(`${prefix}User`)) $(`${prefix}User`).value = server.user || "";
  if ($(`${prefix}SslPort`)) $(`${prefix}SslPort`).value = server.ssl_port || "";
  if ($(`${prefix}SshPort`)) $(`${prefix}SshPort`).value = server.ssh_port || "";
  if ($(`${prefix}UdpPort`)) $(`${prefix}UdpPort`).value = server.udp_port || "";
  $(`${prefix}Host`).value = server.host || "";
  $(`${prefix}Port`).value = server.port || server.ssh_port || "";
  $(`${prefix}Status`).value = server.active || server.status === "active" ? "active" : "inactive";
  $(`${prefix}Premium`).value = String(Boolean(server.premium));
  setLinkedProfileValue(prefix, server);
  $(`${prefix}SortOrder`).value = numberValue(server.sort_order);
}

function updateOvpnModeFields() {
  const protocol = $("ovpnProtocol").value;
  const mode = $("ovpnMode").value || "NORMAL";
  const showOvpn = isOvpnProtocol(protocol);
  const showPayload = showOvpn && OVPN_MODES_WITH_PAYLOAD.includes(mode);
  const showProxy = showOvpn && mode === "PAYLOAD_PROXY";
  const showSsl = showOvpn && OVPN_MODES_WITH_SSL.includes(mode);

  document.querySelectorAll(".ovpn-only").forEach((field) => {
    field.classList.toggle("hidden", !showOvpn);
  });
  document.querySelectorAll(".ovpn-payload-field").forEach((field) => {
    field.classList.toggle("hidden", !showPayload);
  });
  document.querySelectorAll(".ovpn-proxy-field").forEach((field) => {
    field.classList.toggle("hidden", !showProxy);
  });
  document.querySelectorAll(".ovpn-ssl-field").forEach((field) => {
    field.classList.toggle("hidden", !showSsl);
  });
}

function updateV2rayFields() {
  const protocol = $("v2rayProtocol").value;
  const network = $("v2rayNetworkType").value.trim().toLowerCase();
  const security = $("v2raySecurity").value.trim().toLowerCase();
  const isWs = network === "ws" || network === "httpupgrade";
  const isGrpc = network === "grpc";
  const isTls = security === "tls" || $("v2rayTls").value === "true";
  const isReality = security === "reality";

  $("v2rayAlterId").closest("label").classList.toggle("hidden", protocol !== "VMESS");
  $("v2rayEncryption").closest("label").classList.toggle("hidden", protocol !== "VLESS");
  $("v2rayFlow").closest("label").classList.toggle("hidden", protocol !== "VLESS");
  $("v2rayPath").closest("label").classList.toggle("hidden", !isWs);
  $("v2rayHostHeader").closest("label").classList.toggle("hidden", !isWs);
  $("v2rayServiceName").closest("label").classList.toggle("hidden", !isGrpc);
  $("v2raySni").closest("label").classList.toggle("hidden", !(isTls || isReality));
  $("v2rayAlpn").closest("label").classList.toggle("hidden", !isTls);
  $("v2rayAllowInsecure").closest("label").classList.toggle("hidden", !(isTls || isReality));
  $("v2rayFingerprint").closest("label").classList.toggle("hidden", !(isTls || isReality));
  $("v2rayPublicKey").closest("label").classList.toggle("hidden", !isReality);
  $("v2rayShortId").closest("label").classList.toggle("hidden", !isReality);
  $("v2raySpiderX").closest("label").classList.toggle("hidden", !isReality);
}

function updateTrojanFields() {
  const network = $("trojanNetworkType").value.trim().toLowerCase();
  const tlsEnabled = $("trojanTls").value === "true";
  const isWs = network === "ws" || network === "httpupgrade";
  const isGrpc = network === "grpc";

  $("trojanHostHeader").closest("label").classList.toggle("hidden", !isWs);
  $("trojanPath").closest("label").classList.toggle("hidden", !isWs);
  $("trojanServiceName").closest("label").classList.toggle("hidden", !isGrpc);
  $("trojanSni").closest("label").classList.toggle("hidden", !tlsEnabled);
  $("trojanAlpn").closest("label").classList.toggle("hidden", !tlsEnabled);
  $("trojanAllowInsecure").closest("label").classList.toggle("hidden", !tlsEnabled);
}

function updateSsFields() {
  const showPlugin = Boolean($("ssPluginMode").value);
  document.querySelectorAll(".ss-plugin-field").forEach((field) => {
    field.classList.toggle("hidden", !showPlugin);
  });
}

function editServer(id) {
  const server = state.servers.find((item) => item.id === id);
  if (!server) return;

  if (isV2rayProtocol(server.protocol)) {
    setCommon("v2ray", server);
    $("v2rayProtocol").value = server.protocol === "V2Ray VMess" ? "VMESS" : server.protocol === "V2Ray VLESS" ? "VLESS" : server.protocol || "VLESS";
    $("v2rayUuid").value = server.uuid || "";
    $("v2rayAlterId").value = numberValue(server.alter_id);
    $("v2rayEncryption").value = server.encryption || (server.protocol === "VLESS" ? "none" : "");
    $("v2raySecurity").value = server.security || "";
    $("v2rayNetworkType").value = server.network_type || "";
    $("v2rayPath").value = server.path || "";
    $("v2rayHostHeader").value = server.host_header || "";
    $("v2raySni").value = server.sni || "";
    $("v2rayTls").value = String(Boolean(server.tls));
    $("v2rayAllowInsecure").value = String(Boolean(server.allow_insecure));
    $("v2rayAlpn").value = server.alpn || "";
    $("v2rayFingerprint").value = server.fingerprint || server.fp || "";
    $("v2rayServiceName").value = server.serviceName || "";
    $("v2rayFlow").value = server.flow || "";
    $("v2rayPublicKey").value = server.public_key || server.pbk || "";
    $("v2rayShortId").value = server.short_id || server.sid || "";
    $("v2raySpiderX").value = server.spider_x || server.spx || "";
    updateV2rayFields();
    $("v2rayFormTitle").textContent = "Edit V2Ray Server";
  } else if (server.protocol === "SSH") {
    setCommon("ssh", server);
    $("sshProtocol").value = "SSH";
    $("sshUsername").value = server.username || "";
    $("sshPassword").value = server.password || "";
    $("sshSni").value = server.sni || "";
    $("sshSslHost").value = server.sslHost || "";
    $("sshTlsVersion").value = server.tlsVersion || "";
    $("sshVerifySsl").value = String(server.verifySsl !== false);
    $("sshAllowInsecure").value = String(Boolean(server.allowInsecure));
    $("sshFormTitle").textContent = "Edit SSH Server";
  } else if (isOvpnProtocol(server.protocol)) {
    setCommon("ovpn", server);
    $("ovpnProtocol").value = "OVPN";
    $("ovpnPing").value = server.ping || "";
    $("ovpnMode").value = server.ovpnMode || "NORMAL";
    $("ovpnUsername").value = server.username || "";
    $("ovpnPassword").value = "";
    $("ovpnSni").value = server.sni || "";
    $("ovpnConfigText").value = server.ovpnConfigText || server.ovpn_config || "";
    $("ovpnConfigUrl").value = server.ovpnConfigUrl || "";
    $("ovpnPayload").value = server.payload || "";
    $("ovpnPayloadHost").value = server.payloadHost || "";
    $("ovpnPayloadPort").value = server.payloadPort || "";
    $("ovpnPayloadMethod").value = server.payloadMethod || "";
    $("ovpnPayloadHeaders").value = server.payloadHeaders || "";
    $("ovpnProxyHost").value = server.proxyHost || "";
    $("ovpnProxyPort").value = server.proxyPort || "";
    $("ovpnProxyUsername").value = server.proxyUsername || "";
    $("ovpnProxyPassword").value = "";
    $("ovpnSslHost").value = "";
    $("ovpnSniHost").value = server.sniHost || server.sslHost || "";
    $("ovpnTlsVersion").value = server.tlsVersion || "";
    $("ovpnVerifySsl").value = String(server.verifySsl !== false);
    $("ovpnAllowInsecure").value = String(Boolean(server.allowInsecure));
    updateOvpnModeFields();
    $("ovpnFormTitle").textContent = "Edit OpenVPN Server";
  } else if (isTrojanProtocol(server.protocol)) {
    setCommon("trojan", server);
    $("trojanProtocol").value = "TROJAN";
    $("trojanPassword").value = server.trojan_password || server.password || "";
    $("trojanSni").value = server.sni || "";
    $("trojanNetworkType").value = server.network_type || "";
    $("trojanHostHeader").value = server.host_header || "";
    $("trojanPath").value = server.path || "";
    $("trojanAlpn").value = server.alpn || "";
    $("trojanServiceName").value = server.serviceName || "";
    $("trojanTls").value = String(Boolean(server.tls));
    $("trojanTlsVersion").value = server.tlsVersion || "";
    $("trojanAllowInsecure").value = String(Boolean(server.allowInsecure));
    updateTrojanFields();
    $("trojanFormTitle").textContent = "Edit Trojan Server";
  } else if (isShadowsocksProtocol(server.protocol)) {
    setCommon("ss", server);
    $("ssProtocol").value = "SHADOWSOCKS";
    $("ssMethod").value = server.ss_method || "";
    $("ssPassword").value = server.password || "";
    $("ssSni").value = server.sni || "";
    $("ssPluginMode").value = server.pluginMode || "";
    $("ssPluginOptions").value = server.pluginOptions || "";
    $("ssHostHeader").value = server.host_header || "";
    $("ssPath").value = server.path || "";
    $("ssTls").value = String(Boolean(server.tls));
    updateSsFields();
    $("ssFormTitle").textContent = "Edit Shadowsocks Server";
  }

  showScreen(protocolScreens[server.protocol] || "v2rayScreen");
}

async function duplicateServer(id) {
  const server = state.servers.find((item) => item.id === id);
  if (!server) return;
  const { id: ignoredId, ...copy } = server;
  copy.server_name = `${server.server_name || "Server"} Copy`;
  copy.sort_order = numberValue(server.sort_order) + 1;
  copy.updated_at = serverTimestamp();

  await writeWithVersion(async (transaction) => {
    transaction.set(doc(serverCollections), copy);
  });
  showToast("Server duplicated and config version increased.");
}

async function updateServerFields(id, fields) {
  await writeWithVersion(async (transaction) => {
    transaction.update(doc(db, "servers", id), {
      ...fields,
      updated_at: serverTimestamp()
    });
  });
}

async function handleServerAction(action, id) {
  const server = state.servers.find((item) => item.id === id);
  if (!server) return;

  try {
    if (action === "edit-server") {
      editServer(id);
      return;
    }
    if (action === "duplicate-server") {
      await duplicateServer(id);
      return;
    }
    if (action === "toggle-server-status") {
      const active = !(server.active || server.status === "active");
      await updateServerFields(id, { active, status: active ? "active" : "inactive" });
      showToast("Server status updated.");
      return;
    }
    if (action === "delete-server" && window.confirm(`Delete ${server.server_name || id}?`)) {
      await writeWithVersion(async (transaction) => {
        transaction.delete(doc(db, "servers", id));
      });
      showToast("Server deleted and config version increased.");
    }
  } catch (error) {
    showToast(firebaseMessage(error), "error");
  }
}

function resetV2rayForm() {
  $("v2rayForm").reset();
  $("v2rayDocId").value = "";
  $("v2rayCustomId").disabled = false;
  $("v2rayProtocol").value = "VLESS";
  $("v2rayAlterId").value = 0;
  $("v2rayEncryption").value = "none";
  $("v2raySecurity").value = "none";
  $("v2rayProfile").value = "";
  $("v2raySortOrder").value = 0;
  $("v2rayFormTitle").textContent = "Manual Add V2Ray Server";
  updateV2rayFields();
}

function resetSshForm() {
  $("sshForm").reset();
  $("sshDocId").value = "";
  $("sshCustomId").disabled = false;
  $("sshProtocol").value = "SSH";
  $("sshVerifySsl").value = "true";
  $("sshAllowInsecure").value = "false";
  $("sshProfile").value = "";
  $("sshSortOrder").value = 0;
  $("sshFormTitle").textContent = "Add SSH Server";
}

function resetOvpnForm() {
  $("ovpnForm").reset();
  $("ovpnDocId").value = "";
  $("ovpnCustomId").disabled = false;
  $("ovpnProtocol").value = "OVPN";
  $("ovpnMode").value = "NORMAL";
  $("ovpnVerifySsl").value = "true";
  $("ovpnAllowInsecure").value = "false";
  $("ovpnProfile").value = "";
  $("ovpnSortOrder").value = 0;
  $("ovpnFormTitle").textContent = "Add OpenVPN Server";
  updateOvpnModeFields();
}

function resetTrojanForm() {
  $("trojanForm").reset();
  $("trojanDocId").value = "";
  $("trojanCustomId").disabled = false;
  $("trojanProtocol").value = "TROJAN";
  $("trojanAllowInsecure").value = "false";
  $("trojanTls").value = "true";
  $("trojanProfile").value = "";
  $("trojanSortOrder").value = 0;
  $("trojanFormTitle").textContent = "Add Trojan Server";
  updateTrojanFields();
}

function resetSsForm() {
  $("ssForm").reset();
  $("ssDocId").value = "";
  $("ssCustomId").disabled = false;
  $("ssProtocol").value = "SHADOWSOCKS";
  $("ssPluginMode").value = "";
  $("ssTls").value = "false";
  $("ssProfile").value = "";
  $("ssSortOrder").value = 0;
  $("ssFormTitle").textContent = "Add Shadowsocks Server";
  updateSsFields();
}

function decodeBase64Url(text) {
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return decodeURIComponent(Array.from(atob(padded), (char) => {
    return `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`;
  }).join(""));
}

function importV2rayLink() {
  const link = $("v2rayImportText").value.trim();
  if (!link) {
    showToast("Paste a vmess:// or vless:// link first.", "error");
    return;
  }

  try {
    if (link.startsWith("vmess://")) {
      const json = JSON.parse(decodeBase64Url(link.replace("vmess://", "")));
      resetV2rayForm();
      $("v2rayProtocol").value = "VMESS";
      $("v2rayName").value = json.ps || json.name || "Imported VMess";
      $("v2rayHost").value = json.add || "";
      $("v2rayPort").value = json.port || "";
      $("v2rayUuid").value = json.id || "";
      $("v2rayAlterId").value = numberValue(json.aid);
      $("v2rayEncryption").value = json.encryption || "";
      $("v2raySecurity").value = json.scy || json.security || "";
      $("v2rayNetworkType").value = json.net || "";
      $("v2rayPath").value = json.path || "";
      $("v2rayHostHeader").value = json.host || "";
      $("v2raySni").value = json.sni || "";
      $("v2rayAlpn").value = json.alpn || "";
      $("v2rayServiceName").value = json.serviceName || "";
      $("v2rayTls").value = String(json.tls === "tls" || json.tls === true);
      updateV2rayFields();
      showToast("VMess link parsed. Review the preview, edit if needed, then save.");
      return;
    }

    if (link.startsWith("vless://")) {
      const parsed = new URL(link);
      resetV2rayForm();
      $("v2rayProtocol").value = "VLESS";
      $("v2rayName").value = decodeURIComponent(parsed.hash.replace("#", "")) || "Imported VLESS";
      $("v2rayHost").value = parsed.hostname || "";
      $("v2rayPort").value = parsed.port || "";
      $("v2rayUuid").value = decodeURIComponent(parsed.username || "");
      $("v2rayNetworkType").value = parsed.searchParams.get("type") || "";
      $("v2raySecurity").value = parsed.searchParams.get("security") || "";
      $("v2rayEncryption").value = parsed.searchParams.get("encryption") || "none";
      $("v2raySni").value = parsed.searchParams.get("sni") || "";
      $("v2rayHostHeader").value = parsed.searchParams.get("host") || "";
      $("v2rayPath").value = parsed.searchParams.get("path") || "";
      $("v2rayAlpn").value = parsed.searchParams.get("alpn") || "";
      $("v2rayFingerprint").value = parsed.searchParams.get("fp") || "";
      $("v2rayServiceName").value = parsed.searchParams.get("serviceName") || "";
      $("v2rayFlow").value = parsed.searchParams.get("flow") || "";
      $("v2rayPublicKey").value = parsed.searchParams.get("pbk") || "";
      $("v2rayShortId").value = parsed.searchParams.get("sid") || "";
      $("v2raySpiderX").value = parsed.searchParams.get("spx") || "";
      $("v2rayTls").value = String(["tls", "reality"].includes(parsed.searchParams.get("security")));
      updateV2rayFields();
      showToast("VLESS link parsed. Review the preview, edit if needed, then save.");
      return;
    }

    throw new Error("Unsupported V2Ray link. Use vmess:// or vless://.");
  } catch (error) {
    showToast(firebaseMessage(error), "error");
  }
}

function importTrojanUri() {
  const link = $("trojanImportText").value.trim();
  if (!link) {
    showToast("Paste a trojan:// URI first.", "error");
    return;
  }

  try {
    const parsed = new URL(link);
    if (parsed.protocol !== "trojan:") throw new Error("Use a trojan:// URI.");
    resetTrojanForm();
    $("trojanProtocol").value = "TROJAN";
    $("trojanName").value = decodeURIComponent(parsed.hash.replace("#", "")) || "Imported Trojan";
    $("trojanHost").value = parsed.hostname || "";
    $("trojanPort").value = parsed.port || "";
    $("trojanPassword").value = decodeURIComponent(parsed.username || "");
    $("trojanNetworkType").value = parsed.searchParams.get("type") || parsed.searchParams.get("network") || "tcp";
    $("trojanSni").value = parsed.searchParams.get("sni") || "";
    $("trojanHostHeader").value = parsed.searchParams.get("host") || "";
    $("trojanPath").value = parsed.searchParams.get("path") || "";
    $("trojanAlpn").value = parsed.searchParams.get("alpn") || "";
    $("trojanServiceName").value = parsed.searchParams.get("serviceName") || "";
    $("trojanTls").value = String((parsed.searchParams.get("security") || "tls") !== "none");
    $("trojanAllowInsecure").value = String(parsed.searchParams.get("allowInsecure") === "1" || parsed.searchParams.get("allowInsecure") === "true");
    updateTrojanFields();
    showToast("Trojan URI parsed. Review, edit if needed, then save.");
  } catch (error) {
    showToast(firebaseMessage(error), "error");
  }
}

function decodeSsUserInfo(value) {
  const decoded = decodeURIComponent(value || "");
  if (decoded.includes(":")) return decoded;
  try {
    return decodeBase64Url(decoded);
  } catch {
    return decoded;
  }
}

function importSsUri() {
  const link = $("ssImportText").value.trim();
  if (!link) {
    showToast("Paste an ss:// URI first.", "error");
    return;
  }

  try {
    if (!link.startsWith("ss://")) throw new Error("Use an ss:// URI.");
    let working = link.replace("ss://", "");
    const [withoutHash, hash = ""] = working.split("#");
    const [mainPart, query = ""] = withoutHash.split("?");
    const params = new URLSearchParams(query);
    let userInfo = "";
    let hostPort = "";

    if (mainPart.includes("@")) {
      [userInfo, hostPort] = mainPart.split("@");
    } else {
      const decoded = decodeBase64Url(mainPart);
      const atIndex = decoded.lastIndexOf("@");
      if (atIndex === -1) throw new Error("Invalid Shadowsocks URI.");
      userInfo = decoded.slice(0, atIndex);
      hostPort = decoded.slice(atIndex + 1);
    }

    const credentials = decodeSsUserInfo(userInfo);
    const colonIndex = credentials.indexOf(":");
    const method = colonIndex >= 0 ? credentials.slice(0, colonIndex) : "";
    const password = colonIndex >= 0 ? credentials.slice(colonIndex + 1) : "";
    const lastColon = hostPort.lastIndexOf(":");
    const host = lastColon >= 0 ? hostPort.slice(0, lastColon) : hostPort;
    const port = lastColon >= 0 ? hostPort.slice(lastColon + 1) : "";

    resetSsForm();
    $("ssName").value = decodeURIComponent(hash || "") || "Imported Shadowsocks";
    $("ssHost").value = host;
    $("ssPort").value = port;
    $("ssMethod").value = method;
    $("ssPassword").value = password;
    const plugin = params.get("plugin") || "";
    if (plugin) {
      $("ssPluginMode").value = plugin.includes("v2ray-plugin") ? "v2ray-plugin" : "obfs-local";
      $("ssPluginOptions").value = plugin;
      $("ssTls").value = String(plugin.includes("tls"));
      const hostMatch = plugin.match(/host=([^;]+)/);
      const pathMatch = plugin.match(/path=([^;]+)/);
      $("ssSni").value = hostMatch ? decodeURIComponent(hostMatch[1]) : "";
      $("ssHostHeader").value = hostMatch ? decodeURIComponent(hostMatch[1]) : "";
      $("ssPath").value = pathMatch ? decodeURIComponent(pathMatch[1]) : "";
    }
    updateSsFields();
    showToast("Shadowsocks URI parsed. Review, edit if needed, then save.");
  } catch (error) {
    showToast(firebaseMessage(error), "error");
  }
}

function importOvpnConfig() {
  const configText = $("ovpnImportText").value.trim();
  if (!configText) {
    showToast("Paste an OpenVPN config first.", "error");
    return;
  }

  const remoteMatch = configText.match(/^\s*remote\s+(\S+)(?:\s+(\d+))?/im);
  $("ovpnConfigText").value = configText;
  if (remoteMatch) {
    $("ovpnHost").value = remoteMatch[1] || "";
    $("ovpnPort").value = remoteMatch[2] || "";
  }
  if (!$("ovpnName").value.trim()) $("ovpnName").value = "Imported OpenVPN";
  $("ovpnProtocol").value = "OVPN";
  updateOvpnModeFields();
  showToast("OpenVPN config parsed. Review, edit if needed, then save.");
}

function renderProfiles() {
  const term = els.profileSearch.value.trim().toLowerCase();
  const filtered = state.profiles.filter((profile) => {
    return `${profileNameOf(profile)} ${profileIdOf(profile)}`.toLowerCase().includes(term);
  });

  if (!filtered.length) {
    els.profilesList.innerHTML = '<div class="empty-state">No profiles found.</div>';
    return;
  }

  els.profilesList.innerHTML = filtered.map((profile) => {
    const active = profileIsActive(profile);
    const image = profile.imageUrl
      ? `<img class="item-media" src="${escapeAttr(profile.imageUrl)}" alt="">`
      : `<span class="flag-fallback">${escapeHtml((profileNameOf(profile)[0] || "P").toUpperCase())}</span>`;

    return `
    <article class="item-card">
      <div class="item-card-header">
        ${image}
        <div>
          <h4 class="item-title">${escapeHtml(profileNameOf(profile))}</h4>
          <p class="item-subtitle">${escapeHtml(profileIdOf(profile) || profile.id)}</p>
        </div>
        <span class="badge ${active ? "" : "inactive"}">${active ? "active" : "inactive"}</span>
      </div>
      <div class="badge-row">
        <span class="badge">${escapeHtml(profile.icon || "icon")}</span>
        <span class="badge">Order ${numberValue(profile.order ?? profile.sort_order)}</span>
      </div>
      <div class="item-actions">
        <button class="secondary-btn" data-action="edit-profile" data-id="${escapeAttr(profile.id)}" type="button">Edit</button>
        <button class="ghost-btn" data-action="toggle-profile-status" data-id="${escapeAttr(profile.id)}" type="button">${active ? "Disable" : "Enable"}</button>
        <button class="danger-btn" data-action="delete-profile" data-id="${escapeAttr(profile.id)}" type="button">Delete</button>
      </div>
    </article>
  `;
  }).join("");
}

function profilePayload() {
  const existingId = $("profileDocId").value.trim();
  const existingProfile = state.profiles.find((profile) => profile.id === existingId);
  const profile_name = $("profileName").value.trim();
  const profileId = existingProfile ? profileIdOf(existingProfile) : safeId(profile_name);
  const active = $("profileStatus").value === "active";
  const order = numberValue($("profileSortOrder").value);

  if (!profileId || !profile_name) {
    throw new Error("Profile ID and Profile Name are required.");
  }

  return {
    profileId,
    name: profile_name,
    imageUrl: $("profileImageUrl").value.trim(),
    active,
    order,
    profile_name,
    icon: $("profileIcon").value.trim(),
    status: active ? "active" : "inactive",
    sort_order: order,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updated_at: serverTimestamp()
  };
}

async function saveProfile(event) {
  event.preventDefault();
  const button = $("saveProfileButton");
  setButtonLoading(button, true, "Saving...");
  try {
    const existingId = $("profileDocId").value.trim();
    const data = profilePayload();
    if (existingId) delete data.createdAt;
    const targetRef = existingId
      ? doc(db, "profiles", existingId)
      : data.profileId
        ? doc(db, "profiles", data.profileId)
        : doc(collection(db, "profiles"));

    await writeWithVersion(async (transaction) => {
      transaction.set(targetRef, data, { merge: Boolean(existingId) });
    });

    resetProfileForm();
    showToast("Profile saved and config version increased.");
  } catch (error) {
    showToast(firebaseMessage(error), "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function editProfile(id) {
  const profile = state.profiles.find((item) => item.id === id);
  if (!profile) return;

  $("profileDocId").value = profile.id;
  $("profileName").value = profileNameOf(profile);
  $("profileImageUrl").value = profile.imageUrl || "";
  $("profileIcon").value = profile.icon || "";
  $("profileStatus").value = profileIsActive(profile) ? "active" : "inactive";
  $("profileSortOrder").value = numberValue(profile.order ?? profile.sort_order);
  $("profileFormTitle").textContent = "Edit Profile";
  showScreen("profilesScreen");
}

function resetProfileForm() {
  $("profileForm").reset();
  $("profileDocId").value = "";
  $("profileSortOrder").value = 0;
  $("profileFormTitle").textContent = "Add Profile";
}

async function updateProfileFields(id, fields) {
  await writeWithVersion(async (transaction) => {
    transaction.update(doc(db, "profiles", id), {
      ...fields,
      updated_at: serverTimestamp()
    });
  });
}

async function handleProfileAction(action, id) {
  const profile = state.profiles.find((item) => item.id === id);
  if (!profile) return;

  try {
    if (action === "edit-profile") {
      editProfile(id);
      return;
    }
    if (action === "toggle-profile-status") {
      const active = !profileIsActive(profile);
      await updateProfileFields(id, { active, status: active ? "active" : "inactive" });
      showToast("Profile status updated.");
      return;
    }
    if (action === "delete-profile" && window.confirm(`Delete ${profile.profile_name || id}?`)) {
      await writeWithVersion(async (transaction) => {
        transaction.delete(doc(db, "profiles", id));
      });
      showToast("Profile deleted and config version increased.");
    }
  } catch (error) {
    showToast(firebaseMessage(error), "error");
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const button = $("saveSettingsButton");
  setButtonLoading(button, true, "Saving...");
  try {
    await writeWithVersion(async (transaction) => {
      transaction.set(
        configRef,
        {
          app_notice: $("settingsNotice").value.trim(),
          force_update: boolValue("settingsForceUpdate"),
          minimum_app_version: $("settingsMinimumVersion").value.trim(),
          updated_at: serverTimestamp()
        },
        { merge: true }
      );
    });
    showToast("Settings saved and config version increased.");
  } catch (error) {
    showToast(firebaseMessage(error), "error");
  } finally {
    setButtonLoading(button, false);
  }
}

async function increaseVersion() {
  const button = $("increaseVersionButton");
  setButtonLoading(button, true, "Increasing...");
  try {
    await runTransaction(db, async (transaction) => {
      await bumpConfigVersion(transaction);
    });
    await loadAllData();
    showToast("Config version increased.");
  } catch (error) {
    showToast(firebaseMessage(error), "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("active-screen", screen.id === screenId);
  });
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.screen === screenId);
  });
  els.screenTitle.textContent = screenTitles[screenId] || "Dashboard";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setButtonLoading(els.loginButton, true, "Logging in...");
  try {
    await signInWithEmailAndPassword(auth, $("loginEmail").value.trim(), $("loginPassword").value);
  } catch (error) {
    showToast(firebaseMessage(error), "error");
  } finally {
    setButtonLoading(els.loginButton, false);
  }
});

els.logoutButton.addEventListener("click", async () => {
  try {
    await signOut(auth);
    showToast("Logged out.");
  } catch (error) {
    showToast(firebaseMessage(error), "error");
  }
});

els.refreshButton.addEventListener("click", loadAllData);

$("v2rayForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveServerFromForm("v2ray", v2rayPayload, "saveV2rayButton", resetV2rayForm, "V2Ray server saved and config version increased.");
});
$("sshForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveServerFromForm("ssh", sshPayload, "saveSshButton", resetSshForm, "SSH server saved and config version increased.");
});
$("ovpnForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveServerFromForm("ovpn", ovpnPayload, "saveOvpnButton", resetOvpnForm, "OpenVPN server saved and config version increased.");
});
$("trojanForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveServerFromForm("trojan", trojanPayload, "saveTrojanButton", resetTrojanForm, "Trojan server saved and config version increased.");
});
$("ssForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveServerFromForm("ss", ssPayload, "saveSsButton", resetSsForm, "Shadowsocks server saved and config version increased.");
});

$("importV2rayButton").addEventListener("click", importV2rayLink);
$("importOvpnButton").addEventListener("click", importOvpnConfig);
$("importTrojanButton").addEventListener("click", importTrojanUri);
$("importSsButton").addEventListener("click", importSsUri);
$("v2rayProtocol").addEventListener("change", updateV2rayFields);
$("v2raySecurity").addEventListener("input", updateV2rayFields);
$("v2rayNetworkType").addEventListener("input", updateV2rayFields);
$("v2rayTls").addEventListener("change", updateV2rayFields);
$("ovpnProtocol").addEventListener("change", updateOvpnModeFields);
$("ovpnMode").addEventListener("change", updateOvpnModeFields);
$("trojanNetworkType").addEventListener("input", updateTrojanFields);
$("trojanTls").addEventListener("change", updateTrojanFields);
$("ssPluginMode").addEventListener("change", updateSsFields);
$("resetV2rayForm").addEventListener("click", resetV2rayForm);
$("resetSshForm").addEventListener("click", resetSshForm);
$("resetOvpnForm").addEventListener("click", resetOvpnForm);
$("resetTrojanForm").addEventListener("click", resetTrojanForm);
$("resetSsForm").addEventListener("click", resetSsForm);

["v2raySearch", "sshSearch", "ovpnSearch", "trojanSearch"].forEach((id) => {
  $(id).addEventListener("input", renderAllServerLists);
  $(id.replace("Search", "List")).addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (button) handleServerAction(button.dataset.action, button.dataset.id);
  });
});

$("profileForm").addEventListener("submit", saveProfile);
$("resetProfileForm").addEventListener("click", resetProfileForm);
$("profilesList").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (button) handleProfileAction(button.dataset.action, button.dataset.id);
});
els.profileSearch.addEventListener("input", renderProfiles);

$("settingsForm").addEventListener("submit", saveSettings);
$("increaseVersionButton").addEventListener("click", increaseVersion);

document.querySelectorAll(".nav-link, .nav-shortcut").forEach((button) => {
  button.addEventListener("click", () => showScreen(button.dataset.screen));
});

updateV2rayFields();
updateOvpnModeFields();
updateTrojanFields();
updateSsFields();

onAuthStateChanged(auth, async (user) => {
  if (user) {
    els.userEmail.textContent = user.email || "Signed in";
    els.loginScreen.classList.add("hidden");
    els.adminApp.classList.remove("hidden");
    await loadAllData();
  } else {
    els.adminApp.classList.add("hidden");
    els.loginScreen.classList.remove("hidden");
    state.servers = [];
    state.profiles = [];
    resetV2rayForm();
    resetSshForm();
    resetOvpnForm();
    resetTrojanForm();
    resetSsForm();
    resetProfileForm();
  }
});

updateOvpnModeFields();
