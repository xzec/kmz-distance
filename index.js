import AdmZip from 'adm-zip'
import { parseStringPromise } from 'xml2js'

const DEFAULT_KMZ = 'new_zealand.kmz'
const DEFAULT_KML = 'doc.kml'

const kmzPath = process.argv[2] ?? process.env.KMZ_PATH ?? DEFAULT_KMZ

try {
  const kmz = new AdmZip(kmzPath)

  let kmlEntry = kmz.getEntry(process.env.KML_ENTRY ?? DEFAULT_KML)
  if (!kmlEntry) {
    kmlEntry = kmz.getEntries().find((entry) => entry.entryName.toLowerCase().endsWith('.kml'))
  }

  if (!kmlEntry) {
    throw new Error(`No KML document found inside ${kmzPath}`)
  }

  const kmlText = kmlEntry.getData().toString('utf8')
  const kml = await parseStringPromise(kmlText, { trim: true })

  const segments = collectRouteSegments(kml)
  if (segments.length === 0) {
    console.log(`No LineString routes found in ${kmlEntry.entryName}`)
    process.exit(0)
  }

  segments.forEach((segment, index) => {
    console.log(`${index + 1}. ${segment.name} — ${segment.coordinates.length} points`)
    segment.coordinates.forEach((coordinate) => {
      const altitude = coordinate.altitude != null ? `, alt ${coordinate.altitude.toFixed(2)}` : ''
      console.log(`   lat ${coordinate.latitude.toFixed(5)}, lon ${coordinate.longitude.toFixed(5)}${altitude}`)
    })
    console.log('')
  })
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Failed to read route: ${message}`)
  process.exit(1)
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
