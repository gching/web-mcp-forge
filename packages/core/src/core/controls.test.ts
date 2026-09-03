import { Euler, PerspectiveCamera, Quaternion } from "three";
import { describe, expect, it, vi } from "vitest";

import { Perspective } from "../libs/perspective";

import { RigidControls } from "./controls";
import { MobileRigidControls } from "./mobile-controls";

type BoundInput = {
  callback: () => void;
  code: string;
  occasion: "keydown" | "keyup";
};

const createInputs = () => {
  const bindings: BoundInput[] = [];

  return {
    bindings,
    bind: vi.fn(
      (
        code: string,
        callback: () => void,
        _namespace: string,
        options: { occasion?: "keydown" | "keyup" } = {},
      ) => {
        bindings.push({
          code,
          callback,
          occasion: options.occasion ?? "keydown",
        });
        return vi.fn();
      },
    ),
    trigger: (code: string, occasion: "keydown" | "keyup" = "keydown") =>
      bindings
        .find(
          (binding) => binding.code === code && binding.occasion === occasion,
        )
        ?.callback(),
  };
};

const createControls = () => {
  const ownerDocument = new EventTarget();
  Object.assign(ownerDocument, {
    exitPointerLock: vi.fn(),
    pointerLockElement: null,
  });

  const domElement = new EventTarget();
  Object.assign(domElement, {
    ownerDocument,
    requestPointerLock: vi.fn(),
  });

  const body = {
    aabb: null,
    forces: [0, 0, 0],
    gravityMultiplier: 1,
    impulses: [0, 0, 0],
    resting: [0, 0, 0],
    setPosition: vi.fn(),
    velocity: [0, 0, 0],
  };
  const world = {
    add: vi.fn(),
    physics: { addBody: vi.fn(() => body) },
  };

  return new RigidControls(
    new PerspectiveCamera(),
    domElement as never,
    world as never,
    { initialDirection: [0, 0, -1] },
  );
};

describe("RigidControls observer input", () => {
  it("shares pointer-lock rotation through lookBy", () => {
    const controls = createControls();

    controls.lookBy(100, -50);

    const expected = new Quaternion().setFromEuler(
      new Euler(0.1, -0.2, 0, "YXZ"),
    );
    expect(
      (controls as never as { quaternion: Quaternion }).quaternion.angleTo(
        expected,
      ),
    ).toBeLessThan(1e-6);
  });

  it("gates movement and perspective keys on active input", () => {
    const controls = createControls();
    const inputs = createInputs();
    const perspective = new Perspective(controls, {} as never);

    controls.connect(inputs as never, "in-game");
    perspective.connect(inputs as never, "in-game");

    inputs.trigger("KeyW");
    inputs.trigger("KeyC");
    inputs.trigger("F5");
    expect(controls.movements.front).toBe(false);
    expect(perspective.state).toBe("first");

    controls.setInputActive(true);
    inputs.trigger("KeyW");
    inputs.trigger("KeyC");
    expect(controls.movements.front).toBe(true);
    expect(perspective.state).toBe("third");

    inputs.trigger("KeyW", "keyup");
    controls.setInputActive(false);
    inputs.trigger("KeyA");
    inputs.trigger("F5");
    expect(controls.movements.front).toBe(false);
    expect(controls.movements.left).toBe(false);
    expect(perspective.state).toBe("third");
  });

  it("forwards a rejected lock request as a pointerlockerror event", async () => {
    const controls = createControls();
    const failure = new Error("permission denied");
    const onError = vi.fn();
    (
      controls.domElement as never as {
        requestPointerLock: () => Promise<void>;
      }
    ).requestPointerLock = () => Promise.reject(failure);
    (
      controls as never as { on: (event: string, listener: () => void) => void }
    ).on("pointerlockerror", onError);

    controls.lock();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("reports a pointer-lock request that never locks the canvas", () => {
    vi.useFakeTimers();
    const controls = createControls();
    const inputs = createInputs();
    const onError = vi.fn();
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    controls.connect(inputs as never, "in-game");
    controls.on("pointerlockerror", onError);
    controls.lock();
    vi.advanceTimersByTime(1000);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    logError.mockRestore();
    vi.useRealTimers();
  });

  it("does not retain a callback after its lock request fails", async () => {
    const controls = createControls();
    const inputs = createInputs();
    const failure = new Error("permission denied");
    const onLock = vi.fn();
    const onError = vi.spyOn(console, "error").mockImplementation(() => {});
    const domElement = controls.domElement as never as {
      ownerDocument: EventTarget & { pointerLockElement: EventTarget | null };
      requestPointerLock: () => Promise<void> | void;
    };

    domElement.requestPointerLock = () => Promise.reject(failure);
    controls.connect(inputs as never, "in-game");

    controls.lock(onLock);
    await Promise.resolve();
    await Promise.resolve();
    domElement.ownerDocument.pointerLockElement = controls.domElement;
    domElement.ownerDocument.dispatchEvent(new Event("pointerlockchange"));

    expect(onLock).not.toHaveBeenCalled();
    onError.mockRestore();
  });

  it("keeps a newer lock callback when an older request fails", async () => {
    const controls = createControls();
    const inputs = createInputs();
    const failure = new Error("permission denied");
    const onNewestLock = vi.fn();
    const onError = vi.spyOn(console, "error").mockImplementation(() => {});
    let rejectFirstRequest: (reason: Error) => void;
    const domElement = controls.domElement as never as {
      ownerDocument: EventTarget & { pointerLockElement: EventTarget | null };
      requestPointerLock: () => Promise<void> | void;
    };
    let requestCount = 0;

    domElement.requestPointerLock = () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Promise<void>((_resolve, reject) => {
          rejectFirstRequest = reject;
        });
      }
    };
    controls.connect(inputs as never, "in-game");

    controls.lock();
    controls.lock(onNewestLock);
    if (!rejectFirstRequest) {
      throw new Error("The first request did not expose a rejection handler.");
    }
    rejectFirstRequest(failure);
    await Promise.resolve();
    await Promise.resolve();
    domElement.ownerDocument.pointerLockElement = controls.domElement;
    domElement.ownerDocument.dispatchEvent(new Event("pointerlockchange"));

    expect(onNewestLock).toHaveBeenCalledOnce();
    onError.mockRestore();
  });

  it("keeps mobile perspective input active without pointer lock", () => {
    const domElement = new EventTarget();
    const body = {
      aabb: null,
      forces: [0, 0, 0],
      gravityMultiplier: 1,
      impulses: [0, 0, 0],
      resting: [0, 0, 0],
      setPosition: vi.fn(),
      velocity: [0, 0, 0],
    };
    const world = {
      add: vi.fn(),
      physics: { addBody: vi.fn(() => body) },
    };
    const controls = new MobileRigidControls(
      new PerspectiveCamera(),
      domElement as never,
      world as never,
    );
    const inputs = createInputs();
    const perspective = new Perspective(controls, {} as never);

    perspective.connect(inputs as never, "in-game");
    inputs.trigger("KeyC");

    expect(controls.isInputActive).toBe(true);
    expect(perspective.state).toBe("third");
  });
});
