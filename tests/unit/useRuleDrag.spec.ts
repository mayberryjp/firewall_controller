import { describe, expect, it, vi } from "vitest";
import { useRuleDrag } from "@/composables/useRuleDrag";

function setup() {
  let blocked = false;
  const rules = [{ action: "accept" }, { action: "drop" }];
  const move = vi.fn(), error = vi.fn();
  const table = document.createElement("table");
  table.innerHTML = '<tbody><tr data-rule-index="0"><td><button></button></td></tr><tr data-rule-index="1"><td></td></tr></tbody>';
  const handle = table.querySelector("button")!;
  const capture = vi.fn();
  Object.defineProperty(handle, "setPointerCapture", { value: capture });
  const drag = useRuleDrag({ blocked: () => blocked, snapshot: () => rules, move, error });
  const event = { button: 0, pointerId: 1, clientX: 10, clientY: 10, currentTarget: handle, preventDefault: vi.fn() };
  return { drag, rules, move, error, table, capture, event, block: () => { blocked = true; } };
}

describe("rule dragging", () => {
  it("cancels without staging", () => {
    const { drag, event, move } = setup();
    drag.pointerStart(event, 0);
    drag.dropTarget.value = 1;
    drag.cancel();
    drag.drop();
    expect(move).not.toHaveBeenCalled();
    expect(drag.dropTarget.value).toBeNull();
  });
  it("rejects changes to the rules during a drag", () => {
    const { drag, event, rules, move, error } = setup();
    drag.pointerStart(event, 0);
    drag.dropTarget.value = 1;
    rules.reverse();
    drag.drop();
    expect(move).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("These rules changed while dragging. Try again.");
  });
  it("does not start while blocked or stage if writes become blocked during a drag", () => {
    const { drag, event, move, capture, block } = setup();
    drag.pointerStart(event, 0);
    drag.dropTarget.value = 1;
    block();
    drag.drop();
    expect(move).not.toHaveBeenCalled();
    capture.mockClear();
    drag.pointerStart(event, 0);
    expect(capture).not.toHaveBeenCalled();
  });
  it("does not drop outside its table, including into another rule table", () => {
    const { drag, event, move, table } = setup();
    const foreign = table.cloneNode(true) as HTMLTableElement;
    const original = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
    const hit = vi.fn();
    Object.defineProperty(document, "elementFromPoint", { value: hit, configurable: true });
    try {
      for (const target of [null, foreign.querySelector("td")]) {
        drag.pointerStart(event, 0);
        hit.mockReturnValue(target);
        drag.pointerMove(event);
        drag.drop();
      }
      expect(move).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(document, "elementFromPoint", original);
      else Reflect.deleteProperty(document, "elementFromPoint");
    }
  });
});
