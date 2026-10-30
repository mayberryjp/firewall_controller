import { ref } from "vue";
import { stableJson } from "@/services/configuration";

export function useRuleDrag(options: {
  blocked: () => boolean;
  snapshot: () => unknown;
  move: (from: number, to: number) => void;
  error: (message: string) => void;
}) {
  const dragging = ref<number | null>(null);
  const dropTarget = ref<number | null>(null);
  let start = "";
  function cancel(): void {
    dragging.value = null;
    dropTarget.value = null;
  }
  function pointerStart(event: Pick<PointerEvent, "button" | "pointerId" | "currentTarget" | "preventDefault">, index: number): void {
    if (event.button !== 0 || options.blocked()) return;
    event.preventDefault();
    start = stableJson(options.snapshot());
    dragging.value = index;
    dropTarget.value = index;
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: Pick<PointerEvent, "clientX" | "clientY" | "currentTarget">): void {
    if (dragging.value === null) return;
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-rule-index]");
    dropTarget.value = row && event.currentTarget instanceof HTMLElement && row.closest("table") === event.currentTarget.closest("table")
      ? Number(row.getAttribute("data-rule-index")) : null;
  }
  function drop(): void {
    const from = dragging.value, to = dropTarget.value;
    cancel();
    if (from === null || to === null || options.blocked()) return;
    if (stableJson(options.snapshot()) !== start) {
      options.error("These rules changed while dragging. Try again.");
    } else if (from !== to) options.move(from, to);
  }
  return { dropTarget, pointerStart, pointerMove, drop, cancel };
}
