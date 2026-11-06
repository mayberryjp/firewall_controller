import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { compareInterfaceNames, formatInterfaceName, interfaceNameChoices, sortByInterface } from "@/services/interfaceNames";
import { interfaceChoices } from "@/services/resourceCollections";
import { useResourceCollection } from "@/composables/useResourceCollection";
import { useControllerStore } from "@/stores/controller";
import { state } from "../fixtures";

describe("interface presentation", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("uses case-insensitive alphabetical order without mutating source identities", () => {
    const names = Object.freeze(["wg0", "Eth2", "eth10", "BR0", "aLan"]);
    expect([...names].sort(compareInterfaceNames)).toEqual(["aLan", "BR0", "eth10", "Eth2", "wg0"]);
    expect(formatInterfaceName("aLan")).toBe("ALAN");
    expect(interfaceNameChoices(names)).toEqual([
      { title: "ALAN", value: "aLan" },
      { title: "BR0", value: "BR0" },
      { title: "ETH10", value: "eth10" },
      { title: "ETH2", value: "Eth2" },
      { title: "WG0", value: "wg0" },
    ]);
    expect(names).toEqual(["wg0", "Eth2", "eth10", "BR0", "aLan"]);
  });

  it("sorts by identity rather than metadata and preserves metadata case", () => {
    const links = Object.freeze([
      { name: "wan0", metadata: { display_name: "Alpha uplink", description: "" } },
      { name: "Lan0", metadata: { display_name: "Office", description: "" } },
    ]);
    expect(interfaceChoices(links)).toEqual([
      { title: "LAN0 (Office)", value: "Lan0" },
      { title: "WAN0 (Alpha uplink)", value: "wan0" },
    ]);
    expect(sortByInterface(links, link => link.name)[1]).toBe(links[0]);
    expect(links[0]!.name).toBe("wan0");
  });

  it("preserves source indices and stable row identities across interface sorting and filtering", () => {
    const store = useControllerStore();
    const snapshot = state(), base = snapshot.desired.interfaces[0]!;
    snapshot.desired.interfaces = ["wan0", "Eth2", "eth10"].map(name => ({ ...base, name }));
    store.state.data = snapshot;
    const collection = useResourceCollection("interfaces", false);
    expect(collection.rows.value.map(row => [row.value.name, row.index])).toEqual([
      ["eth10", 2], ["Eth2", 1], ["wan0", 0],
    ]);
    const rowID = collection.rows.value[0]!.rowID;
    collection.filters.search = "eth10";
    expect(collection.rows.value.map(row => [row.value.name, row.index, row.rowID])).toEqual([["eth10", 2, rowID]]);
    expect(snapshot.desired.interfaces.map(link => link.name)).toEqual(["wan0", "Eth2", "eth10"]);
    store.$dispose();
  });

  it("does not alphabetize ordered routing records", () => {
    const store = useControllerStore(), snapshot = state();
    const base = snapshot.desired.routes[0]!;
    snapshot.desired.routes = [{ ...base, interface: "wan0" }, { ...base, interface: "eth0" }];
    store.state.data = snapshot;
    expect(useResourceCollection("routes", false).rows.value.map(row => [row.value.interface, row.index]))
      .toEqual([["wan0", 0], ["eth0", 1]]);
    store.$dispose();
  });
});
