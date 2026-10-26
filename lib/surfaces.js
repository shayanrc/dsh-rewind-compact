/**
 * Surface registration for the bundle entry (SPEC R9, RWC-012).
 *
 * `tools` and `agents` are genuine requirements and stay in the entry's
 * `inject` list. The command and skill surfaces depend on services that not
 * every profile mounts: `sdk-minimal` is a complete tree of its own and ships
 * neither `dsh-commands` nor `dsh-skill`. Declaring those in `inject` left the
 * whole entry PENDING there — silently, by Cordis design — so the tool did not
 * load either.
 *
 * Each optional surface is therefore probed through `ctx.get()` (the documented
 * optional-dependency seam; `ctx.commands`/`ctx.skills` throw without an
 * inject entry) and registered only when its service is present. A missing
 * service logs one clear skip line and every other surface still registers.
 *
 * Every registration is yielded from the entry's single `ctx.effect`, so each
 * surface contributes its own disposer and unloading the entry tears all of
 * them down together.
 */

import { probeService, probeLogger } from './events.js';

/**
 * Probe one optional service and register its surface when present.
 *
 * Yields the service's own disposer (when it registered) so the caller's
 * effect owns cleanup. Logs once and skips when the profile has no such
 * service; a service without a `register` function is treated the same way.
 *
 * @param ctx entry context
 * @param serviceName optional Cordis service name (`commands`, `skills`)
 * @param surfaceLabel human-readable surface name for the skip line
 * @param register factory returning the surface definition to register
 */
export function* registerOptionalSurface(ctx, serviceName, surfaceLabel, register) {
  const service = probeService(ctx, serviceName);
  if (typeof service?.register === 'function') {
    yield service.register(register());
    return;
  }
  probeLogger(ctx).info(
    `[rewind-compact] no ${serviceName} service in this profile — ${surfaceLabel} surface skipped`,
  );
}

/**
 * Register every surface from the entry's one effect, in a fixed order:
 * required tool, optional command, optional skill, TUI decision subscriptions.
 *
 * The tool is the only model-facing surface every profile must get; the TUI
 * subscriptions are plain `ctx.on` listeners (inert where no TUI dispatches
 * those events). Factories are only invoked for surfaces that will register.
 */
export function* registerSurfaces(ctx, { tool, command, skill, decisions }) {
  yield ctx.tools.register(tool);
  yield* registerOptionalSurface(ctx, 'commands', '/rewind-compact command', command);
  yield* registerOptionalSurface(ctx, 'skills', 'rewind-compact skill', skill);
  yield decisions();
}
