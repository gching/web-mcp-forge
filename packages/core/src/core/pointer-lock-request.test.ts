import { describe, expect, it, vi } from "vitest";

import {
  observePointerLockErrors,
  requestPointerLock,
} from "./pointer-lock-request";

describe("requestPointerLock", () => {
  it("uses a supported Pointer Lock API without reporting a failure", async () => {
    const request = vi.fn(() => Promise.resolve());
    const onError = vi.fn();

    requestPointerLock({ requestPointerLock: request }, onError);
    await Promise.resolve();

    expect(request).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports an unavailable Pointer Lock API", () => {
    const onError = vi.fn();

    requestPointerLock({}, onError);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("reports a synchronous Pointer Lock API failure", () => {
    const error = new Error("locked out");
    const onError = vi.fn();

    requestPointerLock(
      {
        requestPointerLock: () => {
          throw error;
        },
      },
      onError,
    );

    expect(onError).toHaveBeenCalledWith(error);
  });

  it("reports a rejected Pointer Lock API promise", async () => {
    const error = new Error("permission denied");
    const onError = vi.fn();

    requestPointerLock(
      { requestPointerLock: () => Promise.reject(error) },
      onError,
    );
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(error);
  });
});

describe("observePointerLockErrors", () => {
  it("forwards the browser pointerlockerror event and detaches cleanly", () => {
    const documentTarget = new EventTarget();
    const onError = vi.fn();
    const stop = observePointerLockErrors(documentTarget, onError);
    const errorEvent = new Event("pointerlockerror");

    documentTarget.dispatchEvent(errorEvent);
    stop();
    documentTarget.dispatchEvent(new Event("pointerlockerror"));

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(errorEvent);
  });
});
