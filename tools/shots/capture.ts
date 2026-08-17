/**
 * Take the marketing screenshots, and QA the components while doing it.
 *
 * The harnesses render the real components through the real compiler, so a
 * chart that has stopped drawing shows up here before it shows up on a
 * customer's dashboard. That is not hypothetical: this pass is what caught the
 * funnel rendering nothing at all, the heatmap drawing as a hairline, and every
 * component shipping without the stylesheet its own markup depends on.
 *
 * The harnesses live here rather than in resources/views because a view is a
 * route: left there, a deployed site would serve sample dashboards at /shot.
 * They are copied in for the run and removed afterwards.
 *
 *     bun run shots
 */
import { cp, mkdir, rm } from 'node:fs/promises'

const MOUNT = 'resources/views/shot'
const PORT = process.env.PORT ?? '3140'

const SHOTS: Array<{ page: string, out: string | null, viewport: string, settle?: number }> = [
  // The QA pass. Every block kind on one page, so a chart that draws nothing is
  // visible rather than merely untested.
  { page: 'gallery', out: null, viewport: '1280x1100', settle: 3000 },
  { page: 'report', out: 'feature-auto-reports.png', viewport: '1240x600' },
  { page: 'share', out: 'feature-sharing.png', viewport: '1180x800' },
  { page: 'integration', out: 'feature-integrations.png', viewport: '900x640', settle: 1500 },
]

await mkdir(MOUNT, { recursive: true })

for (const shot of SHOTS)
  await cp(`tools/shots/${shot.page}.stx`, `${MOUNT}/${shot.page}.stx`).catch(() => {})

console.log(`mounted ${SHOTS.length} harnesses at /${MOUNT}`)
console.log('start the dev server, then run this again with CAPTURE=1 to shoot')

if (process.env.CAPTURE) {
  for (const shot of SHOTS) {
    const url = `http://localhost:${PORT}/shot/${shot.page}`
    const args = [
      'storage/framework/defaults/ai/skills/stacks-browse/scripts/browse.ts',
      'screenshot', url,
      '--viewport', shot.viewport,
      '--scale', '2',
      '--settle', String(shot.settle ?? 2500),
    ]

    if (shot.out)
      args.push('--out', `${process.cwd()}/public/img/${shot.out}`)

    const proc = Bun.spawn(['bun', ...args], { stdout: 'pipe', stderr: 'pipe' })
    await proc.exited

    // The QA line each harness prints, so a broken component fails the run
    // rather than producing a quietly wrong image.
    const html = await fetch(url).then(r => r.text()).catch(() => '')

    if (html.includes('[Foreach Error'))
      throw new Error(`${shot.page}: a binding was empty, so the page rendered a shell`)

    if (html.includes(':EMPTY') && !html.includes('note:EMPTY'))
      throw new Error(`${shot.page}: a block kind drew nothing`)

    console.log(`${shot.page}: ok${shot.out ? ` -> public/img/${shot.out}` : ' (qa only)'}`)
  }

  await rm(MOUNT, { recursive: true, force: true })
  console.log('harnesses removed')
}
