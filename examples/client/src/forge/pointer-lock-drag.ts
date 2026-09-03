type PointerLockDragControls = {
  isLocked: boolean;
  lookBy(deltaX: number, deltaY: number): void;
  resetMovements(): void;
  setInputActive(active: boolean): void;
  on(event: "pointerlockerror", listener: (reason: unknown) => void): unknown;
  off(event: "pointerlockerror", listener: (reason: unknown) => void): unknown;
};

export type PointerLockDragFallback = {
  readonly active: boolean;
  dispose(): void;
};

export const installPointerLockDragFallback = ({
  canvas,
  controls,
  inputNamespace,
  onFallback,
  windowTarget = window,
}: {
  canvas: HTMLCanvasElement;
  controls: PointerLockDragControls;
  inputNamespace: { setNamespace(namespace: "in-game"): void };
  onFallback: () => void;
  windowTarget?: Window;
}): PointerLockDragFallback => {
  let active = false;
  let pointerId: number | undefined;

  const stopDragging = () => {
    if (pointerId === undefined) return;
    if (canvas.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
    pointerId = undefined;
  };

  const activate = () => {
    if (active) return;
    active = true;
    controls.setInputActive(true);
    inputNamespace.setNamespace("in-game");
    onFallback();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!active || controls.isLocked || event.button !== 0) return;
    pointerId = event.pointerId;
    canvas.setPointerCapture(pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    controls.lookBy(event.movementX, event.movementY);
    event.preventDefault();
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (pointerId === event.pointerId) stopDragging();
  };

  const onBlur = () => {
    stopDragging();
    controls.resetMovements();
  };

  const onContextMenu = (event: Event) => event.preventDefault();

  controls.on("pointerlockerror", activate);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);
  canvas.addEventListener("contextmenu", onContextMenu);
  windowTarget.addEventListener("blur", onBlur);

  return {
    get active() {
      return active;
    },
    dispose() {
      stopDragging();
      controls.off("pointerlockerror", activate);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerEnd);
      canvas.removeEventListener("pointercancel", onPointerEnd);
      canvas.removeEventListener("contextmenu", onContextMenu);
      windowTarget.removeEventListener("blur", onBlur);
    },
  };
};
