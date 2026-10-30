import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DeviceIcon from "@/components/base/DeviceIcon.vue";
import defaultIcon from "@/assets/deviceicons/DEFAULT.svg";

const icons = import.meta.glob<string>("../../src/assets/deviceicons/*.svg", { eager: true, query: "?url", import: "default" });

describe("Sando device artwork", () => {
  it.each(["WIFI_ACCESS_POINT", "SERVER", "DESKTOP_COMPUTER", "MOBILE_PHONE", "ESP32_DEVICE"])("uses the original %s SVG", name => {
    const wrapper = mount(DeviceIcon, { props: { name } });
    expect(wrapper.attributes("data-device-icon")).toBe(name);
    expect(wrapper.attributes("style")).toContain(icons[`../../src/assets/deviceicons/${name}.svg`]!);
    expect(wrapper.attributes("aria-hidden")).toBe("true");
    wrapper.unmount();
  });
  it.each([undefined, null, "", "../../outside", "unknown-device"])("uses the bundled DEFAULT for unknown icon %s", name => {
    const wrapper = mount(DeviceIcon, { props: { name } });
    expect(wrapper.attributes("data-device-icon")).toBe("DEFAULT");
    expect(wrapper.attributes("style")).toContain(defaultIcon);
    wrapper.unmount();
  });
  it.each([
    [0, "rgb(0, 200, 83)"], [1, "rgb(255, 214, 0)"], ["24", "rgb(255, 214, 0)"],
    [25, "rgb(255, 152, 0)"], [50, "rgb(255, 152, 0)"],
    [51, "rgb(244, 67, 54)"], [75, "rgb(244, 67, 54)"],
    [76, "rgb(183, 28, 28)"], [100, "rgb(183, 28, 28)"],
    [undefined, "rgb(177, 184, 192)"], [null, "rgb(177, 184, 192)"],
    ["", "rgb(177, 184, 192)"], [" ", "rgb(177, 184, 192)"],
    ["invalid", "rgb(177, 184, 192)"], [false, "rgb(177, 184, 192)"],
    [-1, "rgb(177, 184, 192)"], [NaN, "rgb(177, 184, 192)"], [Infinity, "rgb(177, 184, 192)"],
    [24.5, "rgb(177, 184, 192)"],
  ] as const)("uses Sando's threat-score color or neutral fallback for %s", (score, expected) => {
    const wrapper = mount(DeviceIcon, { props: { score } });
    expect(wrapper.element.style.color).toBe(expected);
    wrapper.unmount();
  });
  it("updates the color when the score changes without changing the icon", async () => {
    const wrapper = mount(DeviceIcon, { props: { name: "SERVER", score: 0 } });
    await wrapper.setProps({ score: 76 });
    expect(wrapper.element.style.color).toBe("rgb(183, 28, 28)");
    expect(wrapper.attributes("data-device-icon")).toBe("SERVER");
    await wrapper.setProps({ score: null });
    expect(wrapper.element.style.color).toBe("rgb(177, 184, 192)");
    wrapper.unmount();
  });
});
