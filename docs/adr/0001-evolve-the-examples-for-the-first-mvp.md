# Evolve the examples for the first MVP

Forge will evolve directly inside `examples/client` and `examples/server` until the first deployed vertical slice works. This keeps the known playable demo intact as the integration starting point; changes to shared Voxelize crates and packages should remain minimal so the fork can still selectively incorporate changes from `upstream`, and dedicated Forge applications can be extracted later if the product boundary warrants it.
