export type PointerLockRequestTarget = {
  requestPointerLock?: () => void | Promise<void>;
};

export type PointerLockFailureHandler = (reason: unknown) => void;

export const requestPointerLock = (
  target: PointerLockRequestTarget,
  onError: PointerLockFailureHandler,
) => {
  const request = target.requestPointerLock;

  if (typeof request !== "function") {
    onError(new Error("Pointer Lock API is unavailable."));
    return;
  }

  try {
    const result = request.call(target);
    if (result && typeof result.then === "function") {
      void Promise.resolve(result).catch(onError);
    }
  } catch (error) {
    onError(error);
  }
};

export const observePointerLockErrors = (
  target: EventTarget,
  onError: PointerLockFailureHandler,
) => {
  const handler = (event: Event) => onError(event);
  target.addEventListener("pointerlockerror", handler);

  return () => target.removeEventListener("pointerlockerror", handler);
};
