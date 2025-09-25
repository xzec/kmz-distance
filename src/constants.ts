import { fileURLToPath } from 'node:url'

import type { ReferencePoint } from './types.ts'

export const DEFAULT_KMZ = fileURLToPath(new URL('../new_zealand.kmz', import.meta.url))
export const DEFAULT_KML = 'doc.kml'
export const DEFAULT_REFERENCE: ReferencePoint = {
  latitude: 48.13978407641908,
  longitude: 17.104469028329717,
}
