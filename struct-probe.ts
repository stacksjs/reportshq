import { install, uninstall } from '@loghq/stacks'
import * as logging from '@stacksjs/logging'

uninstall()
const c = install({
  key: 'loghq_probe0000000000000000000000000000000000000000000000000000000',
  host: 'http://localhost:39117',
  environment: 'production',
  channel: 'reportshq',
  captureStruct: true,
  minLevel: 'debug',
  logger: logging,
})
const s = (logging.log as unknown as { struct: Record<string, (...a: never[]) => void> }).struct
s.request({ method: 'GET', path: '/reports/42', status: 200, duration: 12 } as never)
s.query({ sql: 'select 1', duration: 3 } as never)
s.job({ name: 'digest', status: 'completed', duration: 900 } as never)
s.cache({ key: 'k', hit: true } as never)
logging.log.info('an ordinary line for contrast')
await c.close()
