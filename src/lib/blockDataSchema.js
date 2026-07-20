const DEFAULT_EXCLUDED_PROPERTY_SCHEMA = Object.freeze({
  kind: 'excluded',
  visibility: 'excluded',
  operators: [],
  reason: 'Property is not whitelisted for puzzle generation.',
})

export const PUZZLE_PROPERTY_SCHEMAS = Object.freeze({
  hardness: Object.freeze({
    kind: 'number',
    visibility: 'puzzle',
    label: 'Hardness',
    operators: ['gt', 'eq', 'has', 'not_has'],
  }),
  blast_resistance: Object.freeze({
    kind: 'number',
    visibility: 'puzzle',
    label: 'Blast Resistance',
    operators: ['gt', 'eq', 'has', 'not_has'],
  }),
  emits_power: Object.freeze({
    kind: 'boolean',
    visibility: 'puzzle',
    label: 'Emits Power',
    operators: ['eq', 'has', 'not_has'],
  }),
  material_is_opaque: Object.freeze({
    kind: 'boolean',
    visibility: 'puzzle',
    label: 'Material is Opaque',
    operators: ['eq', 'has', 'not_has'],
  }),
})

export const PUZZLE_PROPERTY_IDS = Object.freeze(Object.keys(PUZZLE_PROPERTY_SCHEMAS))

export function getPropertySchema(propertyId) {
  const schema = PUZZLE_PROPERTY_SCHEMAS[propertyId]

  if (!schema) {
    return {
      propertyId,
      ...DEFAULT_EXCLUDED_PROPERTY_SCHEMA,
    }
  }

  return {
    propertyId,
    ...schema,
  }
}

export function listPuzzlePropertySchemas() {
  return PUZZLE_PROPERTY_IDS.map((propertyId) => getPropertySchema(propertyId))
}

export function isPuzzleProperty(propertyId) {
  return PUZZLE_PROPERTY_IDS.includes(propertyId)
}

export function listExcludedPropertyIds(allPropertyIds = []) {
  return allPropertyIds.filter((propertyId) => !isPuzzleProperty(propertyId))
}