<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useControllerStore } from "@/stores/controller";
import {
  createRegistryDevice, deleteRegistryDevice, getRegistryCredential, listRegistryDevices,
  loginRegistry, logoutRegistry, updateRegistryDevice, type RegistryDevice,
} from "@/services/registry";

const store = useControllerStore(), router = useRouter();
const route = useRoute();
const registryPassword = ref("");
const registryReady = ref(false);
const registryBusy = ref(false);
const registryError = ref<string | null>(null);
const devices = ref<RegistryDevice[]>([]);
const editingId = ref<string | null>(null);
const deviceForm = reactive({ name: "", address: "", credential: "" });

function resetDeviceForm(): void {
  editingId.value = null;
  deviceForm.name = "";
  deviceForm.address = "";
  deviceForm.credential = "";
}

async function refreshDevices(): Promise<void> {
  devices.value = await listRegistryDevices();
}

async function signIn(): Promise<void> {
  registryBusy.value = true;
  registryError.value = null;
  try {
    await loginRegistry(registryPassword.value);
    registryPassword.value = "";
    registryReady.value = true;
    await refreshDevices();
  } catch (error) {
    registryError.value = error instanceof Error ? error.message : "Unable to sign in to the device registry";
  } finally {
    registryBusy.value = false;
  }
}

async function saveDevice(): Promise<void> {
  registryBusy.value = true;
  registryError.value = null;
  try {
    const input = {
      name: deviceForm.name.trim(),
      address: deviceForm.address.trim(),
      ...(deviceForm.credential.trim() ? { credential: deviceForm.credential.trim() } : {}),
    };
    if (editingId.value) await updateRegistryDevice(editingId.value, input);
    else await createRegistryDevice({ ...input, credential: deviceForm.credential.trim() });
    resetDeviceForm();
    await refreshDevices();
  } catch (error) {
    registryError.value = error instanceof Error ? error.message : "Unable to save the device";
  } finally {
    registryBusy.value = false;
  }
}

function editDevice(device: RegistryDevice): void {
  editingId.value = device.id;
  deviceForm.name = device.name;
  deviceForm.address = device.address;
  deviceForm.credential = "";
  registryError.value = null;
}

async function removeDevice(device: RegistryDevice): Promise<void> {
  if (!window.confirm(`Remove ${device.name} and its stored key from the registry?`)) return;
  registryBusy.value = true;
  registryError.value = null;
  try {
    await deleteRegistryDevice(device.id);
    if (editingId.value === device.id) resetDeviceForm();
    await refreshDevices();
  } catch (error) {
    registryError.value = error instanceof Error ? error.message : "Unable to remove the device";
  } finally {
    registryBusy.value = false;
  }
}

async function connectDevice(device: RegistryDevice): Promise<void> {
  registryBusy.value = true;
  registryError.value = null;
  try {
    const credential = await getRegistryCredential(device.id);
    const redirect = route.query.redirect;
    if (await store.connect(credential, device.address)) {
      await router.replace(typeof redirect === "string" && redirect.startsWith("/") && !redirect.startsWith("//")
        ? redirect : "/overview");
    } else {
      registryError.value = store.authError;
    }
  } catch (error) {
    registryError.value = error instanceof Error ? error.message : "Unable to connect to the firewall";
  } finally {
    registryBusy.value = false;
  }
}

function signOut(): void {
  logoutRegistry();
  store.disconnect();
  registryReady.value = false;
  devices.value = [];
  registryError.value = null;
  resetDeviceForm();
}
</script>

<template>
  <section
    class="connect-panel"
    aria-labelledby="connect-title"
  >
    <p class="text-overline text-primary mb-2">
      Isolated lab control plane
    </p>
    <h1
      id="connect-title"
      class="text-h4 mb-4"
    >
      Connect to a firewall
    </h1>

    <template v-if="!registryReady">
      <p class="mb-6">
        Sign in to the central device registry to access saved firewall addresses and keys.
      </p>
      <p class="text-body-2 text-medium-emphasis mb-6">
        Device records persist on the registry server across browser reloads. Firewall keys are encrypted at rest.
      </p>
      <v-card
        border
        class="pa-6"
      >
        <v-form @submit.prevent="signIn">
          <v-text-field
            v-model="registryPassword"
            type="password"
            label="Registry admin password"
            autocomplete="current-password"
            :disabled="registryBusy"
            hint="Device records are stored on the registry server. This login is not saved in the browser."
            persistent-hint
          />
          <v-alert
            v-if="registryError"
            role="alert"
            type="error"
            class="my-4"
          >
            {{ registryError }}
          </v-alert>
          <v-btn
            type="submit"
            color="primary"
            :loading="registryBusy"
            :disabled="!registryPassword"
          >
            Sign in
          </v-btn>
        </v-form>
      </v-card>
    </template>

    <template v-else>
      <div class="d-flex align-center justify-space-between mb-4">
        <p class="mb-0">
          Saved firewalls
        </p>
        <v-btn
          variant="text"
          :disabled="registryBusy"
          @click="signOut"
        >
          Sign out
        </v-btn>
      </div>

      <v-alert
        v-if="registryError"
        role="alert"
        type="error"
        class="mb-4"
      >
        {{ registryError }}
      </v-alert>

      <v-card
        v-for="device in devices"
        :key="device.id"
        border
        class="pa-4 mb-3"
      >
        <div class="d-flex flex-wrap align-center justify-space-between ga-3">
          <div>
            <h2 class="text-h6">
              {{ device.name }}
            </h2>
            <p class="text-body-2 text-medium-emphasis mb-0">
              {{ device.address }}
            </p>
          </div>
          <div class="d-flex flex-wrap ga-2">
            <v-btn
              color="primary"
              :loading="registryBusy"
              :disabled="registryBusy"
              @click="connectDevice(device)"
            >
              Connect
            </v-btn>
            <v-btn
              variant="outlined"
              :disabled="registryBusy"
              @click="editDevice(device)"
            >
              Edit
            </v-btn>
            <v-btn
              color="error"
              variant="text"
              :disabled="registryBusy"
              @click="removeDevice(device)"
            >
              Remove
            </v-btn>
          </div>
        </div>
      </v-card>

      <p
        v-if="!devices.length"
        class="text-medium-emphasis my-6"
      >
        No firewalls are registered yet.
      </p>

      <v-card
        border
        class="pa-6 mt-6"
      >
        <h2 class="text-h6 mb-4">
          {{ editingId ? "Edit firewall" : "Add firewall" }}
        </h2>
        <v-form @submit.prevent="saveDevice">
          <v-text-field
            v-model="deviceForm.name"
            label="Device name"
            autocomplete="off"
            :disabled="registryBusy"
          />
          <v-text-field
            v-model="deviceForm.address"
            label="Device API address"
            placeholder="https://192.0.2.1:8080"
            autocomplete="url"
            hint="Origin only. The firewall API must allow CORS from this website."
            persistent-hint
            :disabled="registryBusy"
          />
          <v-text-field
            v-model="deviceForm.credential"
            type="password"
            label="Firewall bearer key"
            autocomplete="new-password"
            :placeholder="editingId ? 'Leave blank to keep the stored key' : ''"
            hint="Encrypted on the registry server. Returned to this browser only when connecting."
            persistent-hint
            :disabled="registryBusy"
          />
          <div class="d-flex flex-wrap ga-2 mt-2">
            <v-btn
              type="submit"
              color="primary"
              :loading="registryBusy"
              :disabled="registryBusy || !deviceForm.name.trim() || !deviceForm.address.trim() ||
                (!editingId && !deviceForm.credential.trim())"
            >
              {{ editingId ? "Save changes" : "Save firewall" }}
            </v-btn>
            <v-btn
              v-if="editingId"
              variant="text"
              :disabled="registryBusy"
              @click="resetDeviceForm"
            >
              Cancel
            </v-btn>
          </div>
        </v-form>
      </v-card>

      <p class="text-caption text-medium-emphasis mt-5">
        Device addresses and keys persist on the registry server. Keys are encrypted at rest and held in browser memory
        only while connecting to the selected firewall. The browser sends API requests directly to that firewall.
      </p>
    </template>
  </section>
</template>
