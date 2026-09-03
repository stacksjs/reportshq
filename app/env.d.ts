/**
 * This app's own environment variables, taught to `@stacksjs/env`.
 *
 * `StacksEnv` is a closed interface shipped by the framework: a fixed list of
 * the keys IT knows about. Nothing an application declares for itself in
 * config/env.ts extends it, so `env.LOGHQ_KEY` has no type even though
 * config/env.ts declares the key and the value arrives correctly at runtime
 * (`env` proxies process.env, and undeclared keys pass straight through).
 *
 * Before 0.74 the mismatch was invisible, because StacksEnv was permissive
 * enough that any key typechecked. The upgrade closed it, which is how these
 * two surfaced. They are declared in config/env.ts already, which is what
 * gives them validation and a default, and this augmentation is what makes
 * the type agree.
 *
 * Keep the two in step: a key added here without a config/env.ts entry
 * typechecks while going unvalidated, which is the state this file exists to
 * end.
 *
 * It lives under app/ rather than in a root types/ directory because the
 * framework owns the include set (see the comment in tsconfig.json) and that
 * set covers `app/**` but no root `types/**`. Putting it here also keeps it
 * clear of storage/framework/types, which is vendored and overwritten on the
 * next framework bump.
 */

declare module '@stacksjs/env' {
  interface StacksEnv {
    LOGHQ_KEY: string | undefined
    LOGHQ_HOST: string | undefined
  }
}

export {}
