import type { IZipEntry } from 'adm-zip'

import { DEFAULT_KML } from '../constants.ts'
import type { Coordinate, KmlNode, ReferencePoint, RouteSegment } from '../types.ts'

type KmzArchive = {
  getEntry(entryName: string): IZipEntry | null
  getEntries(): IZipEntry[]
}

export function findKmlEntry(kmz: KmzArchive): IZipEntry | null {
  const direct = kmz.getEntry(DEFAULT_KML)
  if (direct) return direct

  const entries = kmz.getEntries()
  const lowerCaseMatch = entries.find((entry) => entry.entryName.toLowerCase().endsWith('.xml'))
  if (lowerCaseMatch) return lowerCaseMatch

  return entries.find((entry) => entry.entryName.toLowerCase().endsWith('.kml')) ?? null
}

export function collectRouteSegments(kml: unknown): RouteSegment[] {
  if (!isRecord(kml)) return []
  const root = kml.kml
  if (!isRecord(root)) return []

  const documents = toArray<KmlNode>(root.Document as KmlNode | KmlNode[] | undefined)
  const segments: RouteSegment[] = []

  for (const document of documents) {
    traverseContainer(document, [])
  }

  return segments

  function traverseContainer(container: KmlNode, ancestors: string[]): void {
    const scopedAncestors = appendName(ancestors, container)

    const placemarks = toArray<KmlNode>(container.Placemark as KmlNode | KmlNode[] | undefined)
    for (const placemark of placemarks) {
      const breadcrumb = appendName(scopedAncestors, placemark)
      const lineStrings = collectLineStrings(placemark)

      lineStrings.forEach((lineString, lineIndex) => {
        const coordinates = parseCoordinates(lineString.coordinates)
        if (coordinates.length === 0) return

        const label =
          lineStrings.length > 1 ? `${breadcrumb.join(' / ')} (segment ${lineIndex + 1})` : breadcrumb.join(' / ')

        segments.push({ name: label || 'Unnamed route', coordinates })
      })
    }

    const folders = toArray<KmlNode>(container.Folder as KmlNode | KmlNode[] | undefined)
    folders.forEach((folder) => {
      traverseContainer(folder, scopedAncestors)
    })
  }
}

export function parseReference(value: string | undefined | null): ReferencePoint | null {
  if (!value) return null

  const [latPart, lonPart] = value.split(',').map((part) => part.trim())

  if (latPart === undefined || lonPart === undefined) {
    return null
  }

  const latitude = Number.parseFloat(latPart)
  const longitude = Number.parseFloat(lonPart)

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null
  }

  return { latitude, longitude }
}

export function haversineDistanceKm(pointA: ReferencePoint, pointB: ReferencePoint): number {
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

function collectLineStrings(node: KmlNode | undefined): KmlNode[] {
  if (!node) return []

  const direct = toArray<KmlNode>(node.LineString as KmlNode | KmlNode[] | undefined)
  const nested = toArray<KmlNode>(node.MultiGeometry as KmlNode | KmlNode[] | undefined).flatMap((child) =>
    collectLineStrings(child),
  )

  return [...direct, ...nested]
}

function parseCoordinates(raw: unknown): Coordinate[] {
  const text = asString(raw)
  if (!text) return []

  const coordinates: Coordinate[] = []
  const tokens = text.split(/\s+/)

  for (const token of tokens) {
    const trimmed = token.trim()
    if (trimmed.length === 0) continue

    const [longitudePart, latitudePart, altitudePart] = trimmed.split(',')
    if (longitudePart === undefined || latitudePart === undefined) continue

    const longitude = Number.parseFloat(longitudePart)
    const latitude = Number.parseFloat(latitudePart)
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue

    const altitudeNumber = altitudePart ? Number.parseFloat(altitudePart) : Number.NaN
    const altitude = Number.isFinite(altitudeNumber) ? altitudeNumber : null

    coordinates.push({ latitude, longitude, altitude })
  }

  return coordinates
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180
}

function appendName(parts: string[], candidate: KmlNode | undefined): string[] {
  const nameValue = candidate ? asString(candidate.name) : null
  if (nameValue) {
    return [...parts, nameValue]
  }

  return [...parts]
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value

  if (Array.isArray(value) && value.length > 0) {
    const first = value[0]
    if (typeof first === 'string') return first
    if (isRecord(first) && typeof first._ === 'string') return first._
  }

  if (isRecord(value) && typeof value._ === 'string') {
    return value._
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
