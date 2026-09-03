import { describe, expect, it, vi } from "vitest";

import { installPointerLockDragFallback } from "./pointer-lock-drag";

class TestCanvas extends EventTarget {
  public captured = new Set<number>();

  setPointerCapture = vi.fn((pointerId: number) => {
    this.captured.add(pointerId);
  });

  releasePointerCapture = vi.fn((pointerId: number) => {
    this.captured.delete(pointerId);
  });

  hasPointerCapture = (pointerId: number) => this.captured.has(pointerId);
}

const pointerEvent = (
  type: string,
  options: {
    button?: number;
    movementX?: number;
    movementY?: number;
    pointerId: number;
  },
) =>
  Object.assign(new Event(type, { cancelable: true }), options) as PointerEvent;

const createControls = () => {
  let onPointerLockError: ((reason: unknown) => void) | undefined;
  const movements = {
    up: true,
    down: false,
    left: false,
    right: true,
    front: true,
    back: false,
    sprint: false,
  };

  return {
    controls: {
      isLocked: false,
      lookBy: vi.fn(),
      movements,
      off: vi.fn(),
      on: vi.fn(
        (_event: "pointerlockerror", listener: (reason: unknown) => void) => {
          onPointerLockError = listener;
        },
      ),
      resetMovements: vi.fn(() => {
        Object.keys(movements).forEach((key) => {
          movements[key as keyof typeof movements] = false;
        });
      }),
      setInputActive: vi.fn(),
    },
    emitPointerLockError: (reason: unknown) => onPointerLockError?.(reason),
  };
};

describe("installPointerLockDragFallback", () => {
  it("activates the in-game input namespace when fallback turns on", () => {
    const canvas = new TestCanvas();
    const { controls, emitPointerLockError } = createControls();
    const inputNamespace = {
      current: "menu",
      setNamespace(namespace: "menu" | "in-game") {
        this.current = namespace;
      },
    };

    installPointerLockDragFallback({
      canvas: canvas as never,
      controls,
      inputNamespace,
      onFallback: vi.fn(),
      windowTarget: new EventTarget() as never,
    });
    emitPointerLockError(new Error("unavailable"));

    expect(inputNamespace.current).toBe("in-game");
  });

  it("persists after failure and routes primary-pointer drags through shared look controls", () => {
    const canvas = new TestCanvas();
    const windowTarget = new EventTarget();
    const { controls, emitPointerLockError } = createControls();
    const onFallback = vi.fn();
    const fallback = installPointerLockDragFallback({
      canvas: canvas as never,
      controls,
      inputNamespace: { setNamespace: vi.fn() },
      onFallback,
      windowTarget: windowTarget as never,
    });

    emitPointerLockError(new Event("pointerlockerror"));
    emitPointerLockError(new Event("pointerlockerror"));
    expect(fallback.active).toBe(true);
    expect(controls.setInputActive).toHaveBeenCalledOnce();
    expect(controls.setInputActive).toHaveBeenCalledWith(true);
    expect(onFallback).toHaveBeenCalledOnce();

    canvas.dispatchEvent(
      pointerEvent("pointerdown", { button: 0, pointerId: 7 }),
    );
    canvas.dispatchEvent(
      pointerEvent("pointermove", {
        movementX: 12,
        movementY: -8,
        pointerId: 7,
      }),
    );
    canvas.dispatchEvent(pointerEvent("pointerup", { pointerId: 7 }));
    canvas.dispatchEvent(
      pointerEvent("pointermove", {
        movementX: 4,
        movementY: 4,
        pointerId: 7,
      }),
    );

    expect(canvas.setPointerCapture).toHaveBeenCalledWith(7);
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(controls.lookBy).toHaveBeenCalledOnce();
    expect(controls.lookBy).toHaveBeenCalledWith(12, -8);
  });

  it("suppresses the canvas menu and clears movements on blur without disabling fallback", () => {
    const canvas = new TestCanvas();
    const windowTarget = new EventTarget();
    const { controls, emitPointerLockError } = createControls();
    const fallback = installPointerLockDragFallback({
      canvas: canvas as never,
      controls,
      inputNamespace: { setNamespace: vi.fn() },
      onFallback: vi.fn(),
      windowTarget: windowTarget as never,
    });
    const menu = new Event("contextmenu", { cancelable: true });

    emitPointerLockError(new Error("unavailable"));
    canvas.dispatchEvent(
      pointerEvent("pointerdown", { button: 0, pointerId: 9 }),
    );
    canvas.dispatchEvent(menu);
    windowTarget.dispatchEvent(new Event("blur"));

    expect(menu.defaultPrevented).toBe(true);
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(9);
    expect(controls.resetMovements).toHaveBeenCalledOnce();
    expect(controls.movements).toEqual({
      up: false,
      down: false,
      left: false,
      right: false,
      front: false,
      back: false,
      sprint: false,
    });
    expect(fallback.active).toBe(true);
  });
});
