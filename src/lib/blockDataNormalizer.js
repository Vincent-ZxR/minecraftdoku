import {
  getPropertySchema,
  listExcludedPropertyIds,
  listPuzzlePropertySchemas,
  PUZZLE_PROPERTY_IDS,
} from './blockDataSchema'

function toValueKey(value) {
  if (value === Infinity) return 'number:Infinity'
  return `${typeof value}:${String(value)}`
}

function slugifyToken(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function collectLeafValues(rawValue, leaves = []) {
  if (rawValue === null || rawValue === undefined) {
    return leaves
  }

  if (Array.isArray(rawValue)) {
    rawValue.forEach((item) => collectLeafValues(item, leaves))
    return leaves
  }

  if (typeof rawValue === 'object') {
    Object.values(rawValue).forEach((item) => collectLeafValues(item, leaves))
    return leaves
  }

  leaves.push(rawValue)
  return leaves
}

function parseNumberValue(rawValue) {
  if (typeof rawValue === 'number') return Number.isFinite(rawValue) ? rawValue : null

  if (typeof rawValue !== 'string') return null

  const trimmed = rawValue.trim()

  if (!trimmed) return null
  if (trimmed === '∞' || trimmed.toLowerCase() === 'infinity') return Infinity

  const parsed = Number(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function parseBooleanValue(rawValue) {
  if (typeof rawValue === 'boolean') return rawValue
  if (typeof rawValue !== 'string') return null

  const normalized = rawValue.trim().toLowerCase()

  if (normalized === 'yes' || normalized === 'true') return true
  if (normalized === 'no' || normalized === 'false') return false
  return null
}

function parseEnumValue(rawValue) {
  if (typeof rawValue !== 'string' && typeof rawValue !== 'number' && typeof rawValue !== 'boolean') {
    return null
  }

  const token = slugifyToken(rawValue)
  return token || null
}

function getLeafParser(schema) {
  if (schema.kind === 'number') return parseNumberValue
  if (schema.kind === 'boolean') return parseBooleanValue
  if (schema.kind === 'enum') return parseEnumValue
  return () => null
}

function normalizeLeafValues(schema, rawValue) {
  const parseLeaf = getLeafParser(schema)
  const valuesByKey = new Map()

  collectLeafValues(rawValue).forEach((leafValue) => {
    const normalizedValue = parseLeaf(leafValue)

    if (normalizedValue === null) return
    if (schema.kind === 'enum' && schema.excludedValues?.includes(normalizedValue)) return
    if (schema.kind === 'enum' && schema.enumValues && !schema.enumValues.includes(normalizedValue)) return

    valuesByKey.set(toValueKey(normalizedValue), normalizedValue)
  })

  return Array.from(valuesByKey.values())
}

function summarizeNormalizedValue(schema, rawValue, source) {
  const values = normalizeLeafValues(schema, rawValue)

  if (!values.length) {
    return {
      propertyId: schema.propertyId,
      kind: schema.kind,
      source,
      rawValue,
      present: false,
      ambiguous: false,
      value: null,
      values: [],
      issue: 'missing',
    }
  }

  if (values.length > 1) {
    return {
      propertyId: schema.propertyId,
      kind: schema.kind,
      source,
      rawValue,
      present: true,
      ambiguous: true,
      value: null,
      values,
      issue: 'variant_conflict',
    }
  }

  return {
    propertyId: schema.propertyId,
    kind: schema.kind,
    source,
    rawValue,
    present: true,
    ambiguous: false,
    value: values[0],
    values,
    issue: null,
  }
}

export function readRawPropertyValue(dataset, propertyId, blockName) {
  const property = dataset?.properties?.[propertyId]

  if (!property) {
    return {
      propertyId,
      blockName,
      found: false,
      source: 'missing_property',
      rawValue: null,
    }
  }

  const entries = property.entries ?? {}
  const hasEntry = Object.prototype.hasOwnProperty.call(entries, blockName)

  return {
    propertyId,
    blockName,
    found: true,
    source: hasEntry ? 'entry' : 'default',
    rawValue: hasEntry ? entries[blockName] : property.default_value ?? null,
  }
}

export function normalizePropertyValue(schemaOrPropertyId, rawValue, source = 'entry') {
  const schema =
    typeof schemaOrPropertyId === 'string' ? getPropertySchema(schemaOrPropertyId) : schemaOrPropertyId

  if (schema.kind === 'excluded') {
    return {
      propertyId: schema.propertyId,
      kind: 'excluded',
      source,
      rawValue,
      present: false,
      ambiguous: false,
      value: null,
      values: [],
      issue: schema.reason,
    }
  }

  return summarizeNormalizedValue(schema, rawValue, source)
}

export function normalizeBlock(dataset, blockName, propertyIds = PUZZLE_PROPERTY_IDS) {
  const properties = {}

  propertyIds.forEach((propertyId) => {
    const rawProperty = readRawPropertyValue(dataset, propertyId, blockName)
    properties[propertyId] = normalizePropertyValue(propertyId, rawProperty.rawValue, rawProperty.source)
  })

  return {
    name: blockName,
    properties,
  }
}

function buildPropertyStats(normalizedBlocks, propertyIds) {
  const stats = Object.fromEntries(
    propertyIds.map((propertyId) => [
      propertyId,
      {
        usableCount: 0,
        ambiguousCount: 0,
        missingCount: 0,
        distinctValues: new Map(),
      },
    ]),
  )

  normalizedBlocks.forEach((block) => {
    propertyIds.forEach((propertyId) => {
      const normalized = block.properties[propertyId]
      const propertyStats = stats[propertyId]

      if (!normalized.present) {
        propertyStats.missingCount += 1
        return
      }

      if (normalized.ambiguous) {
        propertyStats.ambiguousCount += 1
        return
      }

      propertyStats.usableCount += 1
      propertyStats.distinctValues.set(toValueKey(normalized.value), normalized.value)
    })
  })

  return Object.fromEntries(
    Object.entries(stats).map(([propertyId, propertyStats]) => [
      propertyId,
      {
        usableCount: propertyStats.usableCount,
        ambiguousCount: propertyStats.ambiguousCount,
        missingCount: propertyStats.missingCount,
        distinctValues: Array.from(propertyStats.distinctValues.values()),
      },
    ]),
  )
}

export function normalizeBlockDataset(dataset, propertyIds = PUZZLE_PROPERTY_IDS) {
  const blockNames = dataset?.key_list ?? []
  const normalizedBlocks = blockNames.map((blockName) => normalizeBlock(dataset, blockName, propertyIds))
  const allPropertyIds = Object.keys(dataset?.properties ?? {})

  return {
    schemas: listPuzzlePropertySchemas(),
    propertyIds,
    blocks: normalizedBlocks,
    propertyStats: buildPropertyStats(normalizedBlocks, propertyIds),
    excludedPropertyIds: listExcludedPropertyIds(allPropertyIds),
  }
}