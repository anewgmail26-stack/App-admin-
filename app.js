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

// Main app config document used by the Android app and this admin panel.
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
  serverForm: $("serverForm"),
  profileForm: $("profileForm"),
  settingsForm: $("settingsForm"),
  serversList: $("serversList"),
  profilesList: $("profilesList"),
  serverSearch: $("serverSearch"),
  profileSearch: $("profileSearch")
};

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
  return error?.message?.replace("Firebase: ", "") || "Something went wrong.";
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

async function ensureConfig() {
  const snapshot = await getDoc(configRef);
  if (snapshot.exists()) {
    return snapshot.data();
  }

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
    renderServers();
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

function renderServers() {
  const term = els.serverSearch.value.trim().toLowerCase();
  const filtered = state.servers.filter((server) => {
    return `${server.server_name || ""} ${server.country || ""}`.toLowerCase().includes(term);
  });

  if (!filtered.length) {
    els.serversList.innerHTML = '<div class="empty-state">No servers found.</div>';
    return;
  }

  els.serversList.innerHTML = filtered.map((server) => `
    <article class="item-card">
      <div class="item-card-header">
        <div>
          <h4 class="item-title">${escapeHtml(server.server_name || "Unnamed Server")}</h4>
          <p class="item-subtitle">${escapeHtml(server.country || "No country")} - ${escapeHtml(server.host || "No host")}:${escapeHtml(server.port || "")}</p>
        </div>
        <span class="badge ${server.status === "active" ? "" : "inactive"}">${escapeHtml(server.status || "inactive")}</span>
      </div>
      <div class="badge-row">
        <span class="badge">${escapeHtml(server.protocol || "protocol")}</span>
        <span class="badge">${escapeHtml(server.flag || "flag")}</span>
        <span class="badge ${server.premium ? "premium" : ""}">${server.premium ? "Premium" : "Free"}</span>
        <span class="badge">Sort ${numberValue(server.sort_order)}</span>
      </div>
      <div class="item-actions">
        <button class="secondary-btn" data-action="edit-server" data-id="${escapeAttr(server.id)}" type="button">Edit</button>
        <button class="ghost-btn" data-action="toggle-server-status" data-id="${escapeAttr(server.id)}" type="button">${server.status === "active" ? "Disable" : "Enable"}</button>
        <button class="ghost-btn" data-action="toggle-server-premium" data-id="${escapeAttr(server.id)}" type="button">${server.premium ? "Set Free" : "Set Premium"}</button>
        <button class="danger-btn" data-action="delete-server" data-id="${escapeAttr(server.id)}" type="button">Delete</button>
      </div>
    </article>
  `).join("");
}

function renderProfiles() {
  const term = els.profileSearch.value.trim().toLowerCase();
  const filtered = state.profiles.filter((profile) => {
    return `${profile.profile_name || ""} ${profile.country_network || ""}`.toLowerCase().includes(term);
  });

  if (!filtered.length) {
    els.profilesList.innerHTML = '<div class="empty-state">No profiles found.</div>';
    return;
  }

  els.profilesList.innerHTML = filtered.map((profile) => `
    <article class="item-card">
      <div class="item-card-header">
        <div>
          <h4 class="item-title">${escapeHtml(profile.profile_name || "Unnamed Profile")}</h4>
          <p class="item-subtitle">${escapeHtml(profile.country_network || "No network")}</p>
        </div>
        <span class="badge ${profile.status === "active" ? "" : "inactive"}">${escapeHtml(profile.status || "inactive")}</span>
      </div>
      <div class="badge-row">
        <span class="badge">${escapeHtml(profile.icon || "icon")}</span>
        <span class="badge">DNS ${profile.dns_option ? "On" : "Off"}</span>
        <span class="badge">Sort ${numberValue(profile.sort_order)}</span>
      </div>
      <div class="item-actions">
        <button class="secondary-btn" data-action="edit-profile" data-id="${escapeAttr(profile.id)}" type="button">Edit</button>
        <button class="ghost-btn" data-action="toggle-profile-status" data-id="${escapeAttr(profile.id)}" type="button">${profile.status === "active" ? "Disable" : "Enable"}</button>
        <button class="danger-btn" data-action="delete-profile" data-id="${escapeAttr(profile.id)}" type="button">Delete</button>
      </div>
    </article>
  `).join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("active-screen", screen.id === screenId);
  });
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.screen === screenId);
  });
  const titles = {
    dashboardScreen: "Dashboard",
    serversScreen: "Server Management",
    profilesScreen: "Profile Management",
    settingsScreen: "App Settings"
  };
  els.screenTitle.textContent = titles[screenId] || "Dashboard";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function serverPayload() {
  const server_name = $("serverName").value.trim();
  const country = $("serverCountry").value.trim();
  const host = $("serverHost").value.trim();
  const port = $("serverPort").value.trim();

  if (!server_name || !country || !host || !port) {
    throw new Error("Server Name, Country, Host/IP, and Port are required.");
  }

  return {
    // Field names must match the Android app reader.
    server_name,
    country,
    flag: $("serverFlag").value.trim(),
    protocol: $("serverProtocol").value.trim(),
    host,
    port,
    username: $("serverUsername").value.trim(),
    password: $("serverPassword").value.trim(),
    sni: $("serverSni").value.trim(),
    status: $("serverStatus").value,
    premium: $("serverPremium").value === "true",
    sort_order: numberValue($("serverSortOrder").value),
    updated_at: serverTimestamp()
  };
}

function profilePayload() {
  const profile_name = $("profileName").value.trim();
  const country_network = $("profileNetwork").value.trim();
  const payload = $("profilePayload").value.trim();

  if (!profile_name || !country_network || !payload) {
    throw new Error("Profile Name, Country/Network, and Payload are required.");
  }

  return {
    // Field names must match the Android app reader.
    profile_name,
    icon: $("profileIcon").value.trim(),
    country_network,
    payload,
    sni: $("profileSni").value.trim(),
    dns_option: $("profileDns").value === "true",
    status: $("profileStatus").value,
    sort_order: numberValue($("profileSortOrder").value),
    updated_at: serverTimestamp()
  };
}

async function saveServer(event) {
  event.preventDefault();
  const button = $("saveServerButton");
  setButtonLoading(button, true, "Saving...");
  try {
    const existingId = $("serverDocId").value.trim();
    const customId = safeId($("serverCustomId").value);
    const data = serverPayload();
    const targetRef = existingId
      ? doc(db, "servers", existingId)
      : customId
        ? doc(db, "servers", customId)
        : doc(collection(db, "servers"));

    await writeWithVersion(async (transaction) => {
      transaction.set(targetRef, data, { merge: Boolean(existingId) });
    });

    resetServerForm();
    showToast("Server saved and config version increased.");
  } catch (error) {
    showToast(firebaseMessage(error), "error");
  } finally {
    setButtonLoading(button, false);
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const button = $("saveProfileButton");
  setButtonLoading(button, true, "Saving...");
  try {
    const existingId = $("profileDocId").value.trim();
    const customId = safeId($("profileCustomId").value);
    const data = profilePayload();
    const targetRef = existingId
      ? doc(db, "profiles", existingId)
      : customId
        ? doc(db, "profiles", customId)
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
          force_update: $("settingsForceUpdate").value === "true",
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

function editServer(id) {
  const server = state.servers.find((item) => item.id === id);
  if (!server) return;

  $("serverDocId").value = server.id;
  $("serverCustomId").value = server.id;
  $("serverCustomId").disabled = true;
  $("serverName").value = server.server_name || "";
  $("serverCountry").value = server.country || "";
  $("serverFlag").value = server.flag || "";
  $("serverProtocol").value = server.protocol || "";
  $("serverHost").value = server.host || "";
  $("serverPort").value = server.port || "";
  $("serverUsername").value = server.username || "";
  $("serverPassword").value = server.password || "";
  $("serverSni").value = server.sni || "";
  $("serverStatus").value = server.status || "inactive";
  $("serverPremium").value = String(Boolean(server.premium));
  $("serverSortOrder").value = numberValue(server.sort_order);
  $("serverFormTitle").textContent = "Edit Server";
  showScreen("serversScreen");
}

function editProfile(id) {
  const profile = state.profiles.find((item) => item.id === id);
  if (!profile) return;

  $("profileDocId").value = profile.id;
  $("profileCustomId").value = profile.id;
  $("profileCustomId").disabled = true;
  $("profileName").value = profile.profile_name || "";
  $("profileIcon").value = profile.icon || "";
  $("profileNetwork").value = profile.country_network || "";
  $("profilePayload").value = profile.payload || "";
  $("profileSni").value = profile.sni || "";
  $("profileDns").value = String(Boolean(profile.dns_option));
  $("profileStatus").value = profile.status || "inactive";
  $("profileSortOrder").value = numberValue(profile.sort_order);
  $("profileFormTitle").textContent = "Edit Profile";
  showScreen("profilesScreen");
}

function resetServerForm() {
  els.serverForm.reset();
  $("serverDocId").value = "";
  $("serverCustomId").disabled = false;
  $("serverSortOrder").value = 0;
  $("serverFormTitle").textContent = "Add Server";
}

function resetProfileForm() {
  els.profileForm.reset();
  $("profileDocId").value = "";
  $("profileCustomId").disabled = false;
  $("profileSortOrder").value = 0;
  $("profileFormTitle").textContent = "Add Profile";
}

async function updateServerFields(id, fields) {
  await writeWithVersion(async (transaction) => {
    transaction.update(doc(db, "servers", id), {
      ...fields,
      updated_at: serverTimestamp()
    });
  });
}

async function updateProfileFields(id, fields) {
  await writeWithVersion(async (transaction) => {
    transaction.update(doc(db, "profiles", id), {
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
    if (action === "toggle-server-status") {
      await updateServerFields(id, { status: server.status === "active" ? "inactive" : "active" });
      showToast("Server status updated.");
      return;
    }
    if (action === "toggle-server-premium") {
      await updateServerFields(id, { premium: !Boolean(server.premium) });
      showToast("Server access updated.");
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

async function handleProfileAction(action, id) {
  const profile = state.profiles.find((item) => item.id === id);
  if (!profile) return;

  try {
    if (action === "edit-profile") {
      editProfile(id);
      return;
    }
    if (action === "toggle-profile-status") {
      await updateProfileFields(id, { status: profile.status === "active" ? "inactive" : "active" });
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
els.serverForm.addEventListener("submit", saveServer);
els.profileForm.addEventListener("submit", saveProfile);
els.settingsForm.addEventListener("submit", saveSettings);
$("increaseVersionButton").addEventListener("click", increaseVersion);
$("resetServerForm").addEventListener("click", resetServerForm);
$("resetProfileForm").addEventListener("click", resetProfileForm);
els.serverSearch.addEventListener("input", renderServers);
els.profileSearch.addEventListener("input", renderProfiles);

document.querySelectorAll(".nav-link, .nav-shortcut").forEach((button) => {
  button.addEventListener("click", () => showScreen(button.dataset.screen));
});

els.serversList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (button) handleServerAction(button.dataset.action, button.dataset.id);
});

els.profilesList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (button) handleProfileAction(button.dataset.action, button.dataset.id);
});

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
    resetServerForm();
    resetProfileForm();
  }
});
