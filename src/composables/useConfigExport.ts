import { ref } from "vue";
import type { Config } from "@/types/domain";
import { getLatestRevision } from "@/services/netcontrol";
export function useConfigExport() {
  const exportError = ref(""), downloading = ref(false);
  function exportConfig(config: Config, name: string, notice = ""): void {
    if (!window.confirm(`${notice}Export contains sensitive topology, public keys, and key references. Save it only in a trusted location. No credential is included. Continue?`)) return;
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
      link.click(); exportError.value = "";
    } catch (error) { exportError.value = error instanceof Error ? error.message : "Unable to export configuration; select and save the read-only JSON instead."; }
    finally { if (url) setTimeout(() => URL.revokeObjectURL(url!), 1000); }
  }
  async function downloadCommittedConfig(): Promise<void> {
    if (downloading.value) return;
    downloading.value = true; exportError.value = "";
    try {
      const revision = await getLatestRevision();
      exportConfig(revision.config, `netcontrol-config-r${revision.revision}`,
        "Downloads committed configuration only; a pending candidate may be running instead. This is not a full-device backup.\n\n");
    } catch (error) { exportError.value = error instanceof Error ? error.message : "Unable to download committed configuration."; }
    finally { downloading.value = false; }
  }
  return { exportConfig, exportError, downloading, downloadCommittedConfig };
}
