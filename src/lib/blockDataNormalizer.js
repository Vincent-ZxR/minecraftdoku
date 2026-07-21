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

function toGenericToken(rawValue) {
  const leafTokens = Array.from(
    new Set(
      collectLeafValues(rawValue)
        .map((leaf) => {
          if (leaf === null || leaf === undefined) return null

          if (typeof leaf === 'number') {
            if (!Number.isFinite(leaf)) return null
            return `number:${leaf}`
          }

          if (typeof leaf === 'boolean') {
            return `boolean:${leaf}`
          }

          if (typeof leaf === 'string') {
            const normalized = leaf.trim().toLowerCase().replace(/<br\s*\/?>/gi, ' ')
            return normalized ? `string:${normalized}` : null
          }

          return `other:${String(leaf)}`
        })
        .filter(Boolean),
    ),
  ).sort()

  if (!leafTokens.length) return null
  return leafTokens.join(' | ')
}

function buildBlockRarityStats(dataset, blockNames, propertyIds) {
  const totalBlocks = blockNames.length
  const tokenCountsByProperty = {}
  const tokenByBlockAndProperty = {}

  propertyIds.forEach((propertyId) => {
    tokenCountsByProperty[propertyId] = new Map()
    tokenByBlockAndProperty[propertyId] = {}

    blockNames.forEach((blockName) => {
      const { rawValue } = readRawPropertyValue(dataset, propertyId, blockName)
      const token = toGenericToken(rawValue)

      if (!token) return

      tokenByBlockAndProperty[propertyId][blockName] = token
      tokenCountsByProperty[propertyId].set(token, (tokenCountsByProperty[propertyId].get(token) ?? 0) + 1)
    })
  })

  const propertyWeightById = {}

  propertyIds.forEach((propertyId) => {
    const tokenCounts = tokenCountsByProperty[propertyId]
    const coverage = Array.from(tokenCounts.values()).reduce((sum, count) => sum + count, 0)
    const distinctCount = tokenCounts.size

    if (coverage <= 1 || distinctCount <= 1 || totalBlocks <= 1) {
      propertyWeightById[propertyId] = 0
      return
    }

    const probabilities = Array.from(tokenCounts.values()).map((count) => count / coverage)
    const entropy = probabilities.reduce((sum, probability) => {
      return probability > 0 ? sum - probability * Math.log2(probability) : sum
    }, 0)

    const maxEntropy = Math.log2(distinctCount)
    const entropyRatio = maxEntropy > 0 ? entropy / maxEntropy : 0
    const coverageRatio = coverage / totalBlocks
    propertyWeightById[propertyId] = entropyRatio * coverageRatio
  })

  const rawRarityByBlockName = {}

  blockNames.forEach((blockName) => {
    let weightedScore = 0
    let totalWeight = 0
    let contributingProperties = 0

    propertyIds.forEach((propertyId) => {
      const propertyWeight = propertyWeightById[propertyId] ?? 0
      if (propertyWeight <= 0) return

      const token = tokenByBlockAndProperty[propertyId][blockName]
      if (!token) return

      const tokenCounts = tokenCountsByProperty[propertyId]
      const tokenCount = tokenCounts.get(token) ?? 0
      const coverage = Array.from(tokenCounts.values()).reduce((sum, count) => sum + count, 0)
      if (coverage <= 0) return

      const probability = tokenCount / coverage
      const rarityUnitScore = 1 - probability

      weightedScore += propertyWeight * rarityUnitScore
      totalWeight += propertyWeight
      contributingProperties += 1
    })

    rawRarityByBlockName[blockName] = {
      rawScore: totalWeight > 0 ? weightedScore / totalWeight : 0,
      contributingProperties,
    }
  })

  const rawScores = Object.values(rawRarityByBlockName).map((entry) => entry.rawScore)
  const minRawScore = rawScores.length ? Math.min(...rawScores) : 0
  const maxRawScore = rawScores.length ? Math.max(...rawScores) : 1
  const range = maxRawScore - minRawScore

  const byBlockName = {}

  blockNames.forEach((blockName) => {
    const raw = rawRarityByBlockName[blockName] ?? { rawScore: 0, contributingProperties: 0 }
    const normalizedScore = range > 0 ? ((raw.rawScore - minRawScore) / range) * 100 : 0
    const score = Number(normalizedScore.toFixed(1))
    const points = 1 + Math.round((score / 100) * 9)

    byBlockName[blockName] = {
      score,
      points,
      rawScore: Number(raw.rawScore.toFixed(6)),
      contributingProperties: raw.contributingProperties,
    }
  })

  const sortedByScoreDesc = [...blockNames].sort((a, b) => {
    const scoreDiff = (byBlockName[b]?.score ?? 0) - (byBlockName[a]?.score ?? 0)
    if (scoreDiff !== 0) return scoreDiff
    return a.localeCompare(b)
  })

  return {
    byBlockName,
    summary: {
      blockCount: totalBlocks,
      propertyCount: propertyIds.length,
      minScore: byBlockName[sortedByScoreDesc.at(-1)]?.score ?? 0,
      maxScore: byBlockName[sortedByScoreDesc[0]]?.score ?? 0,
      topBlocks: sortedByScoreDesc.slice(0, 10).map((blockName) => ({
        name: blockName,
        ...byBlockName[blockName],
      })),
    },
  }
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
  const rarity = buildBlockRarityStats(dataset, blockNames, allPropertyIds)

  return {
    schemas: listPuzzlePropertySchemas(),
    propertyIds,
    blocks: normalizedBlocks.map((block) => ({
      ...block,
      rarity: rarity.byBlockName[block.name] ?? {
        score: 0,
        points: 1,
        rawScore: 0,
        contributingProperties: 0,
      },
    })),
    propertyStats: buildPropertyStats(normalizedBlocks, propertyIds),
    excludedPropertyIds: listExcludedPropertyIds(allPropertyIds),
    rarity,
  }
}