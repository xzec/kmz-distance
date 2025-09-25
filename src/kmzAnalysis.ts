import AdmZip from 'adm-zip'
import { parseStringPromise } from 'xml2js'

import { DEFAULT_KMZ, DEFAULT_REFERENCE } from './constants.ts'
import type { CliInputs, Config, FurthestCoordinate } from './types.ts'
import { collectRouteSegments, findKmlEntry, haversineDistanceKm, parseReference } from './utils/kml.ts'
import { resolveKmzPath } from './utils/path.ts'

export async function runKmzAnalysis(config: Config): Promise<void> {
  try {
    const kmzPath = resolveKmzPath(config.kmzPath)
    const kmz = new AdmZip(kmzPath)

    const kmlEntry = findKmlEntry(kmz)
    if (!kmlEntry) {
      throw new Error(`No KML document found inside ${config.kmzPath}`)
    }

    const kmlText = kmlEntry.getData().toString('utf8')
    const kml = (await parseStringPromise(kmlText, { trim: true })) as unknown

    const segments = collectRouteSegments(kml)
    if (segments.length === 0) {
      console.log(`No LineString routes found in ${kmlEntry.entryName}`)
      return
    }

    let furthest: FurthestCoordinate | null = null

    for (const [segmentIndex, segment] of segments.entries()) {
      if (config.verbose) {
        console.log(`${segmentIndex + 1}. ${segment.name} — ${segment.coordinates.length} points`)
      }

      for (const [coordinateIndex, coordinate] of segment.coordinates.entries()) {
        const distanceKm = haversineDistanceKm(config.reference, coordinate)

        if (!furthest || distanceKm > furthest.distanceKm) {
          furthest = {
            distanceKm,
            coordinate,
            segment,
            index: coordinateIndex,
          }
        }

        if (config.verbose) {
          const altitude = coordinate.altitude != null ? `, alt ${coordinate.altitude.toFixed(2)}` : ''
          console.log(`   lat ${coordinate.latitude.toFixed(5)}, lon ${coordinate.longitude.toFixed(5)}${altitude}`)
        }
      }

      if (config.verbose) {
        console.log('')
      }
    }

    if (furthest) {
      console.log(
        `Reference point → lat ${config.reference.latitude.toFixed(6)}, lon ${config.reference.longitude.toFixed(6)}`,
      )
      const coordinate = furthest.coordinate
      console.log('Furthest coordinate from reference:')
      console.log(` - Segment: ${furthest.segment.name} (point #${furthest.index + 1})`)
      console.log(` - Location: lat ${coordinate.latitude.toFixed(6)}, lon ${coordinate.longitude.toFixed(6)}`)
      if (coordinate.altitude != null) {
        console.log(` - Altitude: ${coordinate.altitude.toFixed(2)} m`)
      }
      console.log(` - Distance: ${furthest.distanceKm.toFixed(2)} km`)
    }
  } catch (unknownError) {
    const message = unknownError instanceof Error ? unknownError.message : String(unknownError)
    console.error(`Failed to read route: ${message}`)
    process.exitCode = 1
  }
}

export function resolveConfig(cli: CliInputs, env: NodeJS.ProcessEnv): Config {
  const envReference = parseReference(env.REF ?? env.REFERENCE ?? env.KMZ_REFERENCE) ?? null

  const config: Config = {
    kmzPath: env.KMZ_PATH ?? DEFAULT_KMZ,
    reference: envReference ?? DEFAULT_REFERENCE,
    verbose: false,
  }

  let referenceProvided = envReference !== null

  if (cli.flags.kmz) {
    config.kmzPath = cli.flags.kmz
  }

  if (cli.flags.ref) {
    const reference = parseReference(cli.flags.ref)
    if (!reference) {
      throw new Error('Invalid --ref value, expected "lat,lon"')
    }
    config.reference = reference
    referenceProvided = true
  }

  if (cli.flags.verbose !== undefined) {
    config.verbose = cli.flags.verbose
  }

  const [firstArg, secondArg] = cli.positionals

  if (firstArg) {
    if (!cli.flags.kmz && !env.KMZ_PATH && config.kmzPath === DEFAULT_KMZ) {
      config.kmzPath = firstArg
    } else if (!referenceProvided) {
      const reference = parseReference(firstArg)
      if (!reference) {
        throw new Error(`Unexpected argument: ${firstArg}`)
      }
      config.reference = reference
      referenceProvided = true
    } else {
      throw new Error(`Unexpected argument: ${firstArg}`)
    }
  }

  if (secondArg) {
    if (!referenceProvided) {
      const reference = parseReference(secondArg)
      if (!reference) {
        throw new Error(`Unexpected argument: ${secondArg}`)
      }
      config.reference = reference
      referenceProvided = true
    } else {
      throw new Error(`Unexpected argument: ${secondArg}`)
    }
  }

  return config
}
