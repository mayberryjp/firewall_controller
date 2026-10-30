import type { DOMWrapper } from "@vue/test-utils";
import { vi } from "vitest";

export async function dragRule(handle: Pick<DOMWrapper<Element>, "element" | "trigger">, target: Element, pointerType = "mouse"): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
  Object.defineProperty(handle.element, "setPointerCapture", { value: vi.fn(), configurable: true });
  Object.defineProperty(document, "elementFromPoint", { value: () => target, configurable: true });
  try {
    await handle.trigger("pointerdown", { pointerType, pointerId: 1, button: 0 });
    await handle.trigger("pointermove", { pointerType, clientX: 10, clientY: 10 });
    await handle.trigger("pointerup", { pointerType, pointerId: 1 });
  } finally {
    if (original) Object.defineProperty(document, "elementFromPoint", original);
    else Reflect.deleteProperty(document, "elementFromPoint");
  }
}
