import AdmZip from 'adm-zip'
import { parseStringPromise } from 'xml2js'

const DEFAULT_KMZ = 'new_zealand.kmz'
const DEFAULT_KML = 'doc.kml'
const DEFAULT_REFERENCE = {
  latitude: 48.13978407641908,
  longitude: 17.104469028329717,
}

const config = resolveConfig(process.argv.slice(2))

try {
  const kmz = new AdmZip(config.kmzPath)

  let kmlEntry = kmz.getEntry(config.kmlEntry)
  if (!kmlEntry) {
    kmlEntry = kmz.getEntries().find((entry) => entry.entryName.toLowerCase().endsWith('.kml'))
  }

  if (!kmlEntry) {
    throw new Error(`No KML document found inside ${config.kmzPath}`)
  }

  const kmlText = kmlEntry.getData().toString('utf8')
  const kml = await parseStringPromise(kmlText, { trim: true })

  const segments = collectRouteSegments(kml)
  if (segments.length === 0) {
    console.log(`No LineString routes found in ${kmlEntry.entryName}`)
    process.exit(0)
  }

  console.log(
    `Reference point → lat ${config.reference.latitude.toFixed(6)}, lon ${config.reference.longitude.toFixed(6)}`,
  )

  const furthest = {
    distanceKm: Number.NEGATIVE_INFINITY,
    coordinate: null,
    segment: null,
    index: -1,
  }

  segments.forEach((segment, segmentIndex) => {
    console.log(`${segmentIndex + 1}. ${segment.name} — ${segment.coordinates.length} points`)
    segment.coordinates.forEach((coordinate, coordinateIndex) => {
      const distanceKm = haversineDistanceKm(config.reference, coordinate)
      if (distanceKm > furthest.distanceKm) {
        furthest.distanceKm = distanceKm
        furthest.coordinate = coordinate
        furthest.segment = segment
        furthest.index = coordinateIndex
      }

      const altitude = coordinate.altitude != null ? `, alt ${coordinate.altitude.toFixed(2)}` : ''
      console.log(
        `   lat ${coordinate.latitude.toFixed(5)}, lon ${coordinate.longitude.toFixed(5)}${altitude}`,
      )
    })
    console.log('')
  })

  if (furthest.coordinate && furthest.segment) {
    const coordinate = furthest.coordinate
    console.log('Furthest coordinate from reference:')
    console.log(` - Segment: ${furthest.segment.name} (point #${furthest.index + 1})`)
    console.log(
      ` - Location: lat ${coordinate.latitude.toFixed(6)}, lon ${coordinate.longitude.toFixed(6)}`,
    )
    if (coordinate.altitude != null) {
      console.log(` - Altitude: ${coordinate.altitude.toFixed(2)} m`)
    }
    console.log(` - Distance: ${furthest.distanceKm.toFixed(2)} km`)
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Failed to read route: ${message}`)
  process.exit(1)
}

function resolveConfig(argv) {
  const config = {
    kmzPath: process.env.KMZ_PATH ?? DEFAULT_KMZ,
    kmlEntry: process.env.KML_ENTRY ?? DEFAULT_KML,
    reference:
      parseReference(process.env.REF ?? process.env.REFERENCE ?? process.env.KMZ_REFERENCE) ??
      DEFAULT_REFERENCE,
  }

  let expectRefValue = false

  argv.forEach((arg, index) => {
    if (expectRefValue) {
      const reference = parseReference(arg)
      if (!reference) {
        throw new Error(`Invalid --ref value at argument ${index + 3}`)
      }
      config.reference = reference
      expectRefValue = false
      return
    }

    if (arg.startsWith('--ref=')) {
      const value = arg.slice('--ref='.length)
      const reference = parseReference(value)
      if (!reference) throw new Error('Invalid --ref value, expected "lat,lon"')
      config.reference = reference
      return
    }

    if (arg === '--ref') {
      expectRefValue = true
      return
    }

    if (arg.startsWith('--kml=')) {
      config.kmlEntry = arg.slice('--kml='.length)
      return
    }

    if (arg.startsWith('--kmz=')) {
      config.kmzPath = arg.slice('--kmz='.length)
      return
    }

    if (!arg.startsWith('--')) {
      if (config.kmzPath === DEFAULT_KMZ && !process.env.KMZ_PATH) {
        config.kmzPath = arg
        return
      }

      if (config.reference === DEFAULT_REFERENCE) {
        const reference = parseReference(arg)
        if (reference) {
          config.reference = reference
          return
        }
      }

      throw new Error(`Unexpected argument: ${arg}`)
    }

    throw new Error(`Unknown option: ${arg}`)
  })

  if (expectRefValue) {
    throw new Error('Missing value for --ref option')
  }

  return config
}

function collectRouteSegments(kml) {
  const root = kml?.kml
  if (!root) return []

  const documents = toArray(root.Document)
  const segments = []

  for (const document of documents) {
    traverseContainer(document, [])
  }

  return segments

  function traverseContainer(container, ancestors) {
    const scopedAncestors = appendName(ancestors, container)

    const placemarks = toArray(container.Placemark)
    for (const placemark of placemarks) {
      const breadcrumb = appendName(scopedAncestors, placemark)
      const lineStrings = collectLineStrings(placemark)

      lineStrings.forEach((lineString, lineIndex) => {
        const coordinates = parseCoordinates(toArray(lineString.coordinates)[0])
        if (coordinates.length === 0) return

        const label =
          lineStrings.length > 1 ? `${breadcrumb.join(' / ')} (segment ${lineIndex + 1})` : breadcrumb.join(' / ')

        segments.push({ name: label || 'Unnamed route', coordinates })
      })
    }

    const folders = toArray(container.Folder)
    folders.forEach((folder) => traverseContainer(folder, scopedAncestors))
  }
}

function collectLineStrings(node) {
  const direct = toArray(node?.LineString)
  const nested = toArray(node?.MultiGeometry).flatMap((child) => collectLineStrings(child))
  return [...direct, ...nested]
}

function parseCoordinates(raw) {
  const text = typeof raw === 'string' ? raw : raw && typeof raw === 'object' && '_' in raw ? raw._ : ''

  return text
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split(',').map((part) => Number.parseFloat(part)))
    .filter(([longitude, latitude]) => Number.isFinite(longitude) && Number.isFinite(latitude))
    .map(([longitude, latitude, altitude]) => ({
      latitude,
      longitude,
      altitude: Number.isFinite(altitude) ? altitude : null,
    }))
}

function parseReference(value) {
  if (!value) return null

  const [latPart, lonPart] = value.split(',').map((part) => part.trim())
  const latitude = Number.parseFloat(latPart)
  const longitude = Number.parseFloat(lonPart)

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null
  }

  return { latitude, longitude }
}

function haversineDistanceKm(pointA, pointB) {
  const radiusKm = 6371.0088

  const lat1 = degreesToRadians(pointA.latitude)
  const lon1 = degreesToRadians(pointA.longitude)
  const lat2 = degreesToRadians(pointB.latitude)
  const lon2 = degreesToRadians(pointB.longitude)

  const deltaLat = lat2 - lat1
  const deltaLon = lon2 - lon1

  const sinLat = Math.sin(deltaLat / 2)
  const sinLon = Math.sin(deltaLon / 2)

  const a = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return radiusKm * c
}

function degreesToRadians(value) {
  return (value * Math.PI) / 180
}

function appendName(parts, candidate) {
  const nameValue = candidate?.name?.[0]
  if (typeof nameValue === 'string' && nameValue.length > 0) {
    return [...parts, nameValue]
  }

  return parts.slice()
}

function toArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}
