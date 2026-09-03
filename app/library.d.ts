/**
 * `include` and `exclude` on a library package, taught to `@stacksjs/types`.
 *
 * The resolver in @stacksjs/actions reads both and gives `include` the highest
 * precedence of the four ways a package's file set can be named
 * (include > files > tags > default), but `LibraryBuildOptions` declares only
 * `files` and `tags`, so the field that wins is the one with no type.
 *
 * config/library.ts needs it. This app's chart elements live one directory
 * down, in `resources/components/charts`, and the alternatives cannot reach
 * them: a `tags` entry contributes `BarChart.stx`, which does not match a file
 * in a subdirectory, and `files` appends `.ts`. Only a recursive glob covers
 * the real layout.
 *
 * Remove this once the framework declares the fields its own resolver reads.
 * Filed as stacksjs/stacks#2426.
 */

declare module '@stacksjs/types' {
  interface LibraryBuildOptions {
    include?: string[]
    exclude?: string[]
  }
}

export {}
