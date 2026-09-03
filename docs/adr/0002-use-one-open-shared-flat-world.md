# Use one open shared flat world

The MVP has exactly one persistent Forge World, generated from Voxelize's `flat` world and shared by every participant. It intentionally has no identity, authentication, authorization, or per-user world isolation: anyone who can reach the deployment may connect and mutate the world, and the deployment makes no security claim.

## Consequences

The product path does not expose the example world selector or dynamic world creation. Anonymous participants may overwrite the world, and the MVP includes no reset, recovery, backup, or administrative interface.
