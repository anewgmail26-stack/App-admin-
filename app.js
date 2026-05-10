import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
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
const serversCol = collection(db, "servers");
const profilesCol = collection(db, "profiles");

const state = {
  servers: [],
  profiles: [],
  config: { config_version: 0, app_notice: "", force_update: false, minimum_app_version: "" }
};

const $ = (id) => document.getElementById(id);
const els = {
  loginView: $("loginView"),
  appView: $("appView"),
  loginForm: $("loginForm"),
  loginBtn: $("loginBtn"),
  logoutBtn: $("logoutBtn"),
  refreshBtn: $("refreshBtn"),
  userEmail: $("userEmail"),
  title: $("title"),
  serverList: $("serverList"),
  profileList: $("profileList"),
  toast: $("toast")
};

function toast(msg, err = false) {
  els.toast.textContent = msg;
  els.toast.className = `toast show${err ? " err" : ""}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { els.toast.className = "toast"; }, 3200);
}
function setBtn(btn, loading, text = "Loading...") {
  if (!btn) return;
  if (loading) { btn.dataset.t = btn.textContent; btn.textContent = text; btn.disabled = true; }
  else { btn.textContent = btn.dataset.t || btn.textContent; btn.disabled = false; }
}
const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const b = (v) => String(v) === "true" || v === true;
const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const safeId = (v) => String(v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const mask = (v) => {
  const s = String(v || "");
  if (!s) return "empty";
  if (s.length <= 8) return `${s.slice(0, 2)}...`;
  return `${s.slice(0, 4)}...${s.slice(-3)}`;
};

function normalizeProtocol(raw) {
  const v = String(raw || "").trim();
  const map = {
    "vmess": "V2Ray VMess",
    "vless": "V2Ray VLESS",
    "v2ray vmess": "V2Ray VMess",
    "v2ray vless": "V2Ray VLESS",
    "ssh": "SSH",
    "ovpn": "OVPN",
    "openvpn": "OpenVPN",
    "trojan": "Trojan",
    "shadowsocks": "Shadowsocks",
    "ss": "Shadowsocks"
  };
  const key = v.toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ");
  return map[key] || v;
}
function isV2Ray(protocol) { return protocol === "V2Ray VMess" || protocol === "V2Ray VLESS"; }
function normalizeNetwork(net) {
  const x = String(net || "").trim().toLowerCase();
  if (x === "websocket") return "ws";
  if (x === "http-upgrade" || x === "httpupgrade" || x === "http") return "httpupgrade";
  if (x === "tcp" || x === "ws" || x === "grpc") return x;
  return x || "tcp";
}
function normalizePath(net, path) {
  const p = String(path || "").trim();
  if (net !== "ws" && net !== "httpupgrade") return p;
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}
function looksLikeSshWs(payload) {
  const x = String(payload || "").toLowerCase();
  return x.includes("upgrade: websocket") || x.includes("connection: upgrade") || x.includes("get / http/1.1");
}

async function ensureConfig() {
  const snap = await getDoc(configRef);
  if (snap.exists()) return snap.data();
  const base = { config_version: 0, app_notice: "", force_update: false, minimum_app_version: "", updated_at: serverTimestamp() };
  await setDoc(configRef, base);
  return base;
}

async function bumpVersion(tx) {
  tx.set(configRef, { config_version: increment(1), updated_at: serverTimestamp() }, { merge: true });
}
async function withVersion(writer) {
  await runTransaction(db, async (tx) => {
    await writer(tx);
    await bumpVersion(tx);
  });
  await loadAll();
}

async function loadAll() {
  const [cfg, srvSnap, proSnap] = await Promise.all([
    ensureConfig(),
    getDocs(query(serversCol, orderBy("sort_order", "asc"))),
    getDocs(query(profilesCol, orderBy("sort_order", "asc")))
  ]);
  state.config = {
    config_version: n(cfg.config_version),
    app_notice: cfg.app_notice || "",
    force_update: !!cfg.force_update,
    minimum_app_version: cfg.minimum_app_version || ""
  };
  state.servers = srvSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  state.profiles = proSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderAll();
}

function renderAll() {
  $("dashVersion").textContent = state.config.config_version;
  $("dashServers").textContent = state.servers.length;
  $("dashProfiles").textContent = state.profiles.length;
  $("dashNotice").textContent = state.config.app_notice || "-";
  $("settingsNotice").value = state.config.app_notice || "";
  $("settingsForceUpdate").value = String(!!state.config.force_update);
  $("settingsMinVersion").value = state.config.minimum_app_version || "";
  $("settingsConfigVersion").value = String(state.config.config_version);

  const profileSelect = $("serverProfile");
  const selected = profileSelect.value;
  profileSelect.innerHTML = '<option value="">No linked profile</option>';
  state.profiles.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.profile_name || "Unnamed"} - ${p.country_network || "No network"}`;
    profileSelect.appendChild(opt);
  });
  if (selected) profileSelect.value = selected;

  renderServerList();
  renderProfileList();
}

function serverBase(protocol) {
  const profileId = $("serverProfile").value;
  const profile = state.profiles.find((p) => p.id === profileId);
  return {
    server_name: $("serverName").value.trim(),
    country: $("serverCountry").value.trim(),
    flag: $("serverFlag").value.trim(),
    protocol,
    host: $("serverHost").value.trim(),
    port: n($("serverPort").value),
    username: $("serverUsername").value.trim(),
    password: $("serverPassword").value.trim(),
    sni: $("serverSni").value.trim(),
    status: $("serverStatus").value,
    premium: b($("serverPremium").value),
    profile_id: profile ? profile.id : "",
    profile_name: profile ? (profile.profile_name || "") : "",
    sort_order: n($("serverSortOrder").value),
    uuid: $("serverUuid").value.trim(),
    alter_id: n($("serverAlterId").value),
    security: $("serverSecurity").value.trim(),
    network_type: normalizeNetwork($("serverNetworkType").value),
    path: "",
    host_header: $("serverHostHeader").value.trim(),
    tls: b($("serverTls").value),
    allow_insecure: b($("serverAllowInsecure").value),
    flow: $("serverFlow").value.trim(),
    public_key: $("serverPublicKey").value.trim(),
    short_id: $("serverShortId").value.trim(),
    spider_x: $("serverSpiderX").value.trim(),
    trojan_password: $("serverTrojanPassword").value.trim(),
    ss_method: $("serverSsMethod").value.trim(),
    ovpn_config: $("serverOvpnConfig").value.trim(),
    payload: "",
    config: "",
    link: "",
    url: "",
    shareLink: "",
    v2rayLink: "",
    updated_at: serverTimestamp()
  };
}

function buildServerPayload() {
  const protocol = normalizeProtocol($("serverProtocol").value);
  const d = serverBase(protocol);
  d.path = normalizePath(d.network_type, $("serverPath").value.trim());

  const share = $("serverPayload").value.trim();
  if (share && (share.startsWith("vmess://") || share.startsWith("vless://") || share.startsWith("trojan://") || share.startsWith("ss://"))) {
    d.payload = share; d.config = share; d.link = share; d.url = share; d.shareLink = share; d.v2rayLink = share;
  }

  if (!d.server_name || !d.status || $("serverSortOrder").value === "") throw new Error("Server Name, Status, Sort Order required.");
  if (protocol !== "OVPN" && protocol !== "OpenVPN") {
    if (!d.host) throw new Error("Host required.");
    if (d.port < 1 || d.port > 65535) throw new Error("Valid port required (1-65535).");
  }
  if (isV2Ray(protocol)) {
    if (!d.uuid) throw new Error("UUID required for V2Ray.");
    if (!d.network_type) throw new Error("Network Type required for V2Ray.");
    if (d.tls && !d.sni) d.sni = d.host;
  }
  if (protocol === "SSH") {
    if (!d.username || !d.password) throw new Error("SSH username/password required.");
    if (looksLikeSshWs(share || d.password)) {
      throw new Error("SSH over WebSocket not supported by current app backend. Use plain SSH.");
    }
  }
  if ((protocol === "OVPN" || protocol === "OpenVPN") && !d.host && !d.ovpn_config) {
    throw new Error("OpenVPN needs Host or OVPN Config.");
  }
  if (protocol === "Trojan" && !d.trojan_password) throw new Error("Trojan password required.");
  if (protocol === "Shadowsocks" && (!d.ss_method || !d.password)) throw new Error("Shadowsocks method/password required.");
  return d;
}

function resetServerForm() {
  $("serverForm").reset();
  $("serverDocId").value = "";
  $("serverCustomId").disabled = false;
  $("serverSortOrder").value = 0;
  $("serverAlterId").value = 0;
  $("serverFormTitle").textContent = "Add Server";
}

function fillServerForm(s) {
  $("serverDocId").value = s.id || "";
  $("serverCustomId").value = s.id || "";
  $("serverCustomId").disabled = true;
  $("serverName").value = s.server_name || "";
  $("serverCountry").value = s.country || "";
  $("serverFlag").value = s.flag || "";
  $("serverProtocol").value = normalizeProtocol(s.protocol || "V2Ray VMess");
  $("serverHost").value = s.host || "";
  $("serverPort").value = s.port || "";
  $("serverUsername").value = s.username || "";
  $("serverPassword").value = s.password || "";
  $("serverSni").value = s.sni || "";
  $("serverStatus").value = s.status || "active";
  $("serverPremium").value = String(!!s.premium);
  $("serverSortOrder").value = n(s.sort_order);
  $("serverProfile").value = s.profile_id || "";
  $("serverPayload").value = s.payload || s.shareLink || s.link || s.url || s.v2rayLink || "";
  $("serverUuid").value = s.uuid || "";
  $("serverAlterId").value = n(s.alter_id);
  $("serverSecurity").value = s.security || "";
  $("serverNetworkType").value = s.network_type || "";
  $("serverPath").value = s.path || "";
  $("serverHostHeader").value = s.host_header || "";
  $("serverTls").value = String(!!s.tls);
  $("serverAllowInsecure").value = String(!!s.allow_insecure);
  $("serverFlow").value = s.flow || "";
  $("serverPublicKey").value = s.public_key || "";
  $("serverShortId").value = s.short_id || "";
  $("serverSpiderX").value = s.spider_x || "";
  $("serverTrojanPassword").value = s.trojan_password || "";
  $("serverSsMethod").value = s.ss_method || "";
  $("serverOvpnConfig").value = s.ovpn_config || "";
  $("serverFormTitle").textContent = "Edit Server";
  showScreen("servers");
}

function serverCard(s) {
  const active = s.status === "active";
  const proto = normalizeProtocol(s.protocol || "");
  const secret = isV2Ray(proto) ? `UUID ${mask(s.uuid)}` : (proto === "SSH" ? `User ${esc(s.username || "-")}` : "-");
  return `<article class="item">
    <strong>${esc(s.server_name || "Unnamed")}</strong>
    <div class="meta">${esc(proto)} | ${esc(s.host || "-")}:${esc(s.port || "-")}</div>
    <div class="badges">
      <span class="badge ${active ? "ok" : "off"}">${esc(s.status || "inactive")}</span>
      <span class="badge">${s.premium ? "Premium" : "Free"}</span>
      <span class="badge">Sort ${n(s.sort_order)}</span>
      <span class="badge">${esc(secret)}</span>
    </div>
    <div class="actions">
      <button data-act="edit" data-id="${esc(s.id)}">Edit</button>
      <button data-act="dup" data-id="${esc(s.id)}">Duplicate</button>
      <button data-act="toggle" data-id="${esc(s.id)}">${active ? "Disable" : "Enable"}</button>
      <button class="danger" data-act="del" data-id="${esc(s.id)}">Delete</button>
    </div>
  </article>`;
}
function renderServerList() {
  const q = $("serverSearch").value.trim().toLowerCase();
  const rows = state.servers.filter((s) =>
    `${s.server_name || ""} ${s.country || ""} ${s.host || ""} ${s.protocol || ""}`.toLowerCase().includes(q)
  );
  els.serverList.innerHTML = rows.length ? rows.map(serverCard).join("") : `<div class="item">No servers found.</div>`;
}

function profilePayload() {
  const data = {
    profile_name: $("profileName").value.trim(),
    icon: $("profileIcon").value.trim(),
    country_network: $("profileNetwork").value.trim(),
    payload: $("profilePayload").value.trim(),
    sni: $("profileSni").value.trim(),
    dns_option: b($("profileDns").value),
    status: $("profileStatus").value,
    sort_order: n($("profileSortOrder").value),
    updated_at: serverTimestamp()
  };
  if (!data.profile_name || !data.country_network || !data.payload) throw new Error("Profile Name, Network, Payload required.");
  if ($("profileSortOrder").value === "") throw new Error("Profile Sort Order required.");
  return data;
}
function resetProfileForm() {
  $("profileForm").reset();
  $("profileDocId").value = "";
  $("profileCustomId").disabled = false;
  $("profileSortOrder").value = 0;
  $("profileFormTitle").textContent = "Add Profile";
}
function fillProfileForm(p) {
  $("profileDocId").value = p.id;
  $("profileCustomId").value = p.id;
  $("profileCustomId").disabled = true;
  $("profileName").value = p.profile_name || "";
  $("profileIcon").value = p.icon || "";
  $("profileNetwork").value = p.country_network || "";
  $("profilePayload").value = p.payload || "";
  $("profileSni").value = p.sni || "";
  $("profileDns").value = String(!!p.dns_option);
  $("profileStatus").value = p.status || "active";
  $("profileSortOrder").value = n(p.sort_order);
  $("profileFormTitle").textContent = "Edit Profile";
  showScreen("profiles");
}
function renderProfileList() {
  const q = $("profileSearch").value.trim().toLowerCase();
  const rows = state.profiles.filter((p) =>
    `${p.profile_name || ""} ${p.country_network || ""}`.toLowerCase().includes(q)
  );
  els.profileList.innerHTML = rows.length ? rows.map((p) => `
    <article class="item">
      <strong>${esc(p.profile_name || "Unnamed")}</strong>
      <div class="meta">${esc(p.country_network || "-")}</div>
      <div class="badges">
        <span class="badge ${p.status === "active" ? "ok" : "off"}">${esc(p.status || "inactive")}</span>
        <span class="badge">DNS ${p.dns_option ? "On" : "Off"}</span>
        <span class="badge">Sort ${n(p.sort_order)}</span>
      </div>
      <div class="actions">
        <button data-pact="edit" data-id="${esc(p.id)}">Edit</button>
        <button data-pact="toggle" data-id="${esc(p.id)}">${p.status === "active" ? "Disable" : "Enable"}</button>
        <button class="danger" data-pact="del" data-id="${esc(p.id)}">Delete</button>
      </div>
    </article>
  `).join("") : `<div class="item">No profiles found.</div>`;
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((x) => x.classList.toggle("show", x.id === id));
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.screen === id));
  $("title").textContent = id.charAt(0).toUpperCase() + id.slice(1);
}

els.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setBtn(els.loginBtn, true, "Logging in...");
  try {
    await signInWithEmailAndPassword(auth, $("loginEmail").value.trim(), $("loginPassword").value);
  } catch (err) {
    toast(err.message || "Login failed", true);
  } finally { setBtn(els.loginBtn, false); }
});
els.logoutBtn.addEventListener("click", async () => { await signOut(auth); });
els.refreshBtn.addEventListener("click", async () => { await loadAll(); toast("Refreshed."); });

$("serverForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  setBtn($("saveServerBtn"), true, "Saving...");
  try {
    const data = buildServerPayload();
    const id = $("serverDocId").value.trim();
    const custom = safeId($("serverCustomId").value);
    const ref = id ? doc(db, "servers", id) : (custom ? doc(db, "servers", custom) : doc(serversCol));
    await withVersion(async (tx) => tx.set(ref, data, { merge: !!id }));
    resetServerForm();
    toast("Server saved. config_version increased.");
  } catch (err) {
    toast(err.message || "Save failed", true);
  } finally { setBtn($("saveServerBtn"), false); }
});
$("resetServerBtn").addEventListener("click", resetServerForm);
$("serverSearch").addEventListener("input", renderServerList);
els.serverList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  const row = state.servers.find((x) => x.id === id);
  if (!row) return;
  try {
    if (btn.dataset.act === "edit") return fillServerForm(row);
    if (btn.dataset.act === "dup") {
      const { id: _, ...copy } = row;
      copy.server_name = `${row.server_name || "Server"} Copy`;
      copy.sort_order = n(row.sort_order) + 1;
      copy.updated_at = serverTimestamp();
      await withVersion(async (tx) => tx.set(doc(serversCol), copy));
      return toast("Server duplicated.");
    }
    if (btn.dataset.act === "toggle") {
      await withVersion(async (tx) => tx.update(doc(db, "servers", id), { status: row.status === "active" ? "inactive" : "active", updated_at: serverTimestamp() }));
      return toast("Server status updated.");
    }
    if (btn.dataset.act === "del" && window.confirm(`Delete ${row.server_name || id}?`)) {
      await withVersion(async (tx) => tx.delete(doc(db, "servers", id)));
      toast("Server deleted.");
    }
  } catch (err) { toast(err.message || "Action failed", true); }
});

$("profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  setBtn($("saveProfileBtn"), true, "Saving...");
  try {
    const data = profilePayload();
    const id = $("profileDocId").value.trim();
    const custom = safeId($("profileCustomId").value);
    const ref = id ? doc(db, "profiles", id) : (custom ? doc(db, "profiles", custom) : doc(profilesCol));
    await withVersion(async (tx) => tx.set(ref, data, { merge: !!id }));
    resetProfileForm();
    toast("Profile saved.");
  } catch (err) {
    toast(err.message || "Save failed", true);
  } finally { setBtn($("saveProfileBtn"), false); }
});
$("resetProfileBtn").addEventListener("click", resetProfileForm);
$("profileSearch").addEventListener("input", renderProfileList);
els.profileList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-pact]");
  if (!btn) return;
  const id = btn.dataset.id;
  const row = state.profiles.find((x) => x.id === id);
  if (!row) return;
  try {
    if (btn.dataset.pact === "edit") return fillProfileForm(row);
    if (btn.dataset.pact === "toggle") {
      await withVersion(async (tx) => tx.update(doc(db, "profiles", id), { status: row.status === "active" ? "inactive" : "active", updated_at: serverTimestamp() }));
      return toast("Profile status updated.");
    }
    if (btn.dataset.pact === "del" && window.confirm(`Delete ${row.profile_name || id}?`)) {
      await withVersion(async (tx) => tx.delete(doc(db, "profiles", id)));
      toast("Profile deleted.");
    }
  } catch (err) { toast(err.message || "Action failed", true); }
});

$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  setBtn($("saveSettingsBtn"), true, "Saving...");
  try {
    await withVersion(async (tx) => tx.set(configRef, {
      app_notice: $("settingsNotice").value.trim(),
      force_update: b($("settingsForceUpdate").value),
      minimum_app_version: $("settingsMinVersion").value.trim(),
      updated_at: serverTimestamp()
    }, { merge: true }));
    toast("Settings saved.");
  } catch (err) {
    toast(err.message || "Save failed", true);
  } finally { setBtn($("saveSettingsBtn"), false); }
});

$("increaseVersionBtn").addEventListener("click", async () => {
  setBtn($("increaseVersionBtn"), true, "Increasing...");
  try {
    await runTransaction(db, async (tx) => { await bumpVersion(tx); });
    await loadAll();
    toast("config_version increased.");
  } catch (err) {
    toast(err.message || "Failed", true);
  } finally { setBtn($("increaseVersionBtn"), false); }
});

document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => showScreen(t.dataset.screen));
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    els.appView.classList.add("hidden");
    els.loginView.classList.remove("hidden");
    return;
  }
  els.userEmail.textContent = user.email || "-";
  els.loginView.classList.add("hidden");
  els.appView.classList.remove("hidden");
  try {
    await loadAll();
  } catch (err) {
    toast(err.message || "Load failed", true);
  }
});
