import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeBlockDataset } from './lib/blockDataNormalizer'
import { getPropertySchema, PUZZLE_PROPERTY_IDS } from './lib/blockDataSchema'

const LOCAL_BLOCK_DATA_URL = '/data/block_data_1.12.json'
const REMOTE_BLOCK_DATA_URL = 'https://raw.githubusercontent.com/JoakimThorsen/MCPropertyEncyclopedia/main/data/block_data_1.12.json'
const TARGET_PROPERTIES = PUZZLE_PROPERTY_IDS
const GRID_SIZE = 3
const MAX_ERRORS = 3
const MIN_POSSIBLE_ANSWERS_PER_CELL = 3
const MIN_CRITERION_MATCHES = 18
const MAX_GRID_GENERATION_ATTEMPTS = 12000
const DAILY_GAME_STATE_STORAGE_VERSION = 2
const EMPTY_PUZZLE = {
  rowClues: Array(GRID_SIZE).fill(null),
  colClues: Array(GRID_SIZE).fill(null),
  blocks: [],
}

const UI_TEXT = {
  title: 'minecraftdoku',
}

function getTodaySeed() {
  return new Date().toISOString().slice(0, 10)
}

function getGameStateStorageKey(seed) {
  return `minecraftdoku:daily-state:v${DAILY_GAME_STATE_STORAGE_VERSION}:${seed}`
}

function isValidSeedDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime())
}

function sanitizeCachedGrid(grid, knownBlockNames) {
  if (!Array.isArray(grid) || grid.length !== GRID_SIZE * GRID_SIZE) return null

  const seenNames = new Set()
  const sanitized = []

  for (let i = 0; i < grid.length; i += 1) {
    const value = grid[i]

    if (value === null) {
      sanitized.push(null)
      continue
    }

    if (typeof value !== 'string') return null
    if (!knownBlockNames.has(value)) return null
    if (seenNames.has(value)) return null

    seenNames.add(value)
    sanitized.push(value)
  }

  return sanitized
}

function parseCachedGameState(rawValue, knownBlockNames) {
  if (!rawValue) return null

  try {
    const parsed = JSON.parse(rawValue)
    const grid = sanitizeCachedGrid(parsed.grid, knownBlockNames)
    if (!grid) return null

    const parsedErrorCount = Number(parsed.errorCount)
    const errorCount = Number.isInteger(parsedErrorCount)
      ? Math.min(Math.max(parsedErrorCount, 0), MAX_ERRORS)
      : 0

    const parsedScore = Number(parsed.score)
    const score = Number.isFinite(parsedScore) && parsedScore >= 0 ? Math.floor(parsedScore) : 0

    const parsedTryCount = Number(parsed.tryCount)
    const tryCount = Number.isInteger(parsedTryCount) && parsedTryCount >= 1 ? parsedTryCount : 1

    let gameState = parsed.gameState === 'won' || parsed.gameState === 'lost' ? parsed.gameState : 'playing'
    const isGridFull = grid.every(Boolean)

    if (gameState === 'won' && !isGridFull) {
      gameState = 'playing'
    }

    if (gameState === 'lost' && errorCount < MAX_ERRORS) {
      gameState = 'playing'
    }

    if (gameState === 'playing' && isGridFull) {
      gameState = 'won'
    }

    return {
      grid,
      errorCount,
      score,
      tryCount,
      gameState,
      feedbackMessage: typeof parsed.feedbackMessage === 'string' ? parsed.feedbackMessage : '',
    }
  } catch {
    return null
  }
}

function BlockIcon({ sprite, className = '' }) {
  if (!sprite) {
    return <span className={`mc-sprite mc-sprite-fallback ${className}`.trim()} aria-hidden="true" />
  }

  return (
    <span
      className={`mc-sprite ${sprite.sheet} ${className}`.trim()}
      style={{ backgroundPosition: `${sprite.x}px ${sprite.y}px` }}
      aria-hidden="true"
    />
  )
}

function randomFrom(array, seed) {
  if (!array.length) return null
  const x = Math.sin(seed) * 10000
  const idx = Math.floor((x - Math.floor(x)) * array.length)
  return array[idx]
}

function randomIndex(seed, max) {
  if (max <= 0) return 0
  const x = Math.sin(seed) * 10000
  return Math.floor((x - Math.floor(x)) * max)
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function formatTitleCase(value) {
  return String(value)
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function uniqueSortedNumbers(values) {
  return Array.from(new Set(values.filter(isFiniteNumber))).sort((a, b) => a - b)
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value)
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(1)
}

function evaluateCriterion(block, criterion) {
  if (!criterion) return false

  if (criterion.kind === 'name_starts_with') {
    return block.name.toLowerCase().startsWith(criterion.letter.toLowerCase())
  }

  if (criterion.kind === 'name_contains') {
    return block.name.toLowerCase().includes(criterion.letter.toLowerCase())
  }

  if (criterion.kind === 'name_ends_with') {
    return block.name.toLowerCase().endsWith(criterion.letter.toLowerCase())
  }

  const value = block[criterion.propertyId]

  if (criterion.kind === 'number' && isFiniteNumber(value)) {
    if (criterion.operator === 'gt') return value > criterion.threshold
    if (criterion.operator === 'lt') return value < criterion.threshold
    return false
  }

  if (criterion.kind === 'boolean') {
    return value === criterion.expected
  }

  if (criterion.kind === 'enum') {
    return value === criterion.value
  }

  return false
}

function formatCriterionLabel(criterion, propertyInfo) {
  if (!criterion) return '...'

  if (criterion.kind === 'name_starts_with') {
    return `Name starts with '${criterion.letter}'`
  }

  if (criterion.kind === 'name_contains') {
    return `Name contains '${criterion.letter}'`
  }

  if (criterion.kind === 'name_ends_with') {
    return `Name ends with '${criterion.letter}'`
  }

  const propLabel = propertyInfo[criterion.propertyId]?.name ?? criterion.label ?? criterion.propertyId

  if (criterion.kind === 'number') {
    const symbol = criterion.operator === 'lt' ? '<' : '>'
    return `${propLabel} ${symbol} ${formatNumber(criterion.threshold)}`
  }

  if (criterion.kind === 'boolean') {
    return `${propLabel} = ${criterion.expected ? 'Yes' : 'No'}`
  }

  if (criterion.kind === 'enum') {
    return `${propLabel} = ${formatTitleCase(criterion.value)}`
  }

  return propLabel
}

function formatBooleanLabel(value) {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return 'Unknown'
}

function describeCriterionFailure(block, criterion, axisLabel, propertyInfo) {
  if (!criterion) {
    return `${axisLabel}: unknown criterion.`
  }

  if (criterion.kind === 'name_starts_with') {
    return `${axisLabel}: it does not start with letter '${criterion.letter}'.`
  }

  if (criterion.kind === 'name_contains') {
    return `${axisLabel}: it does not contain letter '${criterion.letter}'.`
  }

  if (criterion.kind === 'name_ends_with') {
    return `${axisLabel}: it does not end with letter '${criterion.letter}'.`
  }

  const propertyLabel = propertyInfo[criterion.propertyId]?.name ?? criterion.label ?? criterion.propertyId
  const value = block[criterion.propertyId]

  if (criterion.kind === 'number') {
    const symbol = criterion.operator === 'lt' ? '<' : '>'
    const expected = `${symbol} ${formatNumber(criterion.threshold)}`
    if (!isFiniteNumber(value)) {
      return `${axisLabel}: ${propertyLabel} has no numeric value (expected ${expected}).`
    }
    return `${axisLabel}: ${propertyLabel} = ${formatNumber(value)} (expected ${expected}).`
  }

  if (criterion.kind === 'boolean') {
    return `${axisLabel}: ${propertyLabel} = ${formatBooleanLabel(value)} (expected ${formatBooleanLabel(criterion.expected)}).`
  }

  if (criterion.kind === 'enum') {
    return `${axisLabel}: ${propertyLabel} = ${formatTitleCase(value)} (expected ${formatTitleCase(criterion.value)}).`
  }

  return `${axisLabel}: does not match ${formatCriterionLabel(criterion, propertyInfo)}.`
}

function getCellCoordinates(cellIndex) {
  return {
    rowIndex: Math.floor(cellIndex / GRID_SIZE),
    colIndex: cellIndex % GRID_SIZE,
  }
}

function formatPossibleCount(count) {
  if (count === 1) return '1 possible answer'
  return `${count} possible answers`
}

function formatRarityLabel(score) {
  if (!Number.isFinite(score)) return 'Rarity 0.0'
  return `Rarity ${score.toFixed(1)}`
}

function buildCriterionPool(blocks) {
  if (!blocks.length) return []

  const pool = []
  const hardnessValues = uniqueSortedNumbers(blocks.map((block) => block.hardness))
  const blastValues = uniqueSortedNumbers(blocks.map((block) => block.blast_resistance))
  const materialValues = Array.from(
    new Set(
      blocks
        .map((block) => block.material)
        .filter((value) => typeof value === 'string' && value.trim()),
    ),
  ).sort()

  const addCriterion = (criterion, selectionKey) => {
    pool.push({ ...criterion, selectionKey })
  }

  const addNumericThresholdCriteria = (propertyId, values, label) => {
    if (values.length < 6) return
    const q1 = values[Math.floor(values.length * 0.3)]
    const q2 = values[Math.floor(values.length * 0.5)]
    const q3 = values[Math.floor(values.length * 0.7)]
    const thresholds = uniqueSortedNumbers([q1, q2, q3])

    thresholds.forEach((threshold) => {
      addCriterion({ kind: 'number', propertyId, operator: 'gt', threshold, label }, propertyId)
      addCriterion({ kind: 'number', propertyId, operator: 'lt', threshold, label }, propertyId)
    })
  }

  addNumericThresholdCriteria('hardness', hardnessValues, 'Hardness')
  addNumericThresholdCriteria('blast_resistance', blastValues, 'Blast Resistance')

  addCriterion({ kind: 'boolean', propertyId: 'emits_power', expected: true, label: 'Emits Power' }, 'emits_power')
  addCriterion({ kind: 'boolean', propertyId: 'emits_power', expected: false, label: 'Emits Power' }, 'emits_power')
  addCriterion({ kind: 'boolean', propertyId: 'material_is_opaque', expected: true, label: 'Material is Opaque' }, 'material_is_opaque')
  addCriterion({ kind: 'boolean', propertyId: 'material_is_opaque', expected: false, label: 'Material is Opaque' }, 'material_is_opaque')
  addCriterion({ kind: 'boolean', propertyId: 'material_blocks_movement', expected: true, label: 'Material Blocks Movement' }, 'material_blocks_movement')
  addCriterion({ kind: 'boolean', propertyId: 'material_blocks_movement', expected: false, label: 'Material Blocks Movement' }, 'material_blocks_movement')
  addCriterion({ kind: 'boolean', propertyId: 'material_is_liquid', expected: true, label: 'Material Is Liquid' }, 'material_is_liquid')
  addCriterion({ kind: 'boolean', propertyId: 'material_is_liquid', expected: false, label: 'Material Is Liquid' }, 'material_is_liquid')
  addCriterion({ kind: 'boolean', propertyId: 'material_is_solid', expected: true, label: 'Material Is Solid' }, 'material_is_solid')
  addCriterion({ kind: 'boolean', propertyId: 'material_is_solid', expected: false, label: 'Material Is Solid' }, 'material_is_solid')
  addCriterion({ kind: 'boolean', propertyId: 'material_is_burnable', expected: true, label: 'Material Is Burnable' }, 'material_is_burnable')
  addCriterion({ kind: 'boolean', propertyId: 'material_is_burnable', expected: false, label: 'Material Is Burnable' }, 'material_is_burnable')
  addCriterion({ kind: 'boolean', propertyId: 'suffocates_mobs', expected: true, label: 'Suffocates Mobs' }, 'suffocates_mobs')
  addCriterion({ kind: 'boolean', propertyId: 'suffocates_mobs', expected: false, label: 'Suffocates Mobs' }, 'suffocates_mobs')

  materialValues.forEach((materialValue) => {
    addCriterion({ kind: 'enum', propertyId: 'material', operator: 'eq', value: materialValue, label: 'Material' }, 'material')
  })

  const startLetters = Array.from(
    new Set(
      blocks
        .map((block) => block.name[0]?.toLowerCase())
        .filter((char) => char && char >= 'a' && char <= 'z'),
    ),
  ).sort()

  startLetters.slice(0, 10).forEach((letter) => {
    addCriterion({ kind: 'name_starts_with', letter }, 'name_starts_with')
  })

  const endLetters = Array.from(
    new Set(
      blocks
        .map((block) => block.name.at(-1)?.toLowerCase())
        .filter((char) => char && char >= 'a' && char <= 'z'),
    ),
  ).sort()

  endLetters.slice(0, 10).forEach((letter) => {
    addCriterion({ kind: 'name_ends_with', letter }, 'name_ends_with')
  })

  ;['a', 'e', 'i', 'o', 'u', 's', 't', 'r'].forEach((letter) => {
    addCriterion({ kind: 'name_contains', letter }, 'name_contains')
  })

  return pool
}

async function fetchJsonWithFallback() {
  try {
    const localResp = await fetch(LOCAL_BLOCK_DATA_URL)
    if (!localResp.ok) throw new Error('Local dataset response was not OK')
    return await localResp.json()
  } catch {
    const remoteResp = await fetch(REMOTE_BLOCK_DATA_URL)
    if (!remoteResp.ok) throw new Error('Remote dataset response was not OK')
    return remoteResp.json()
  }
}

function App() {
  const todaySeed = getTodaySeed()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [grid, setGrid] = useState(Array(GRID_SIZE * GRID_SIZE).fill(null))
  const [puzzle, setPuzzle] = useState(EMPTY_PUZZLE)
  const [seed, setSeed] = useState(() => getTodaySeed())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerMode, setPickerMode] = useState('pick')
  const [activeCellIndex, setActiveCellIndex] = useState(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const [possibleAnswers, setPossibleAnswers] = useState([])
  const [errorCount, setErrorCount] = useState(0)
  const [score, setScore] = useState(0)
  const [tryCount, setTryCount] = useState(1)
  const [gameState, setGameState] = useState('playing')
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [resultPopupOpen, setResultPopupOpen] = useState(false)
  const [v2PopupOpen, setV2PopupOpen] = useState(false)
  const [shareFeedbackMessage, setShareFeedbackMessage] = useState('')
  const [shareFallbackText, setShareFallbackText] = useState('')
  const [flashCell, setFlashCell] = useState(null)
  const restoredStateSeedRef = useRef(null)

  const rowClues = puzzle?.rowClues ?? EMPTY_PUZZLE.rowClues
  const colClues = puzzle?.colClues ?? EMPTY_PUZZLE.colClues

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const normalizedSeed = isValidSeedDate(seed) ? seed : todaySeed
    params.set('seed', normalizedSeed)
    const nextQuery = params.toString()
    const nextUrl = `${window.location.pathname}?${nextQuery}${window.location.hash}`
    window.history.replaceState({}, '', nextUrl)
  }, [seed, todaySeed])

  useEffect(() => {
    const handlePopState = () => {
      const nextSeed = getTodaySeed()
      if (nextSeed !== seed) {
        setSeed(nextSeed)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [seed])

  useEffect(() => {
    if (seed !== todaySeed) {
      setSeed(todaySeed)
    }
  }, [seed, todaySeed])

  useEffect(() => {
    fetchJsonWithFallback()
      .then((json) => {
        setData(json)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [])

  const normalizedData = useMemo(() => {
    if (!data) return null
    return normalizeBlockDataset(data, TARGET_PROPERTIES)
  }, [data])

  const blocks = useMemo(() => {
    if (!normalizedData) return []
    return normalizedData.blocks.map((normalizedBlock) => {
      const block = { name: normalizedBlock.name }
      TARGET_PROPERTIES.forEach((pid) => {
        block[pid] = normalizedBlock.properties[pid]?.value ?? null
      })
      block.rarityScore = normalizedBlock.rarity?.score ?? 0
      block.rarityPoints = normalizedBlock.rarity?.points ?? 1
      return block
    })
  }, [normalizedData])

  const blockSprites = useMemo(() => {
    if (!data?.sprites) return {}

    return Object.entries(data.sprites).reduce((acc, [blockName, spriteData]) => {
      if (blockName === '_legacy') return acc
      if (!Array.isArray(spriteData) || spriteData.length < 3) return acc

      acc[blockName] = {
        sheet: spriteData[0],
        x: spriteData[1],
        y: spriteData[2],
      }
      return acc
    }, {})
  }, [data])

  const decorativeSprites = useMemo(() => {
    const entries = Object.entries(blockSprites)
    if (!entries.length) return []

    const count = Math.min(26, entries.length)
    const decorations = []

    for (let i = 0; i < count; i += 1) {
      const idx = randomIndex(i * 97.13 + 11, entries.length)
      const sprite = entries[idx]?.[1]
      if (!sprite) continue

      decorations.push({
        id: `decor-${i}`,
        sprite,
        left: `${(i * 37) % 100}%`,
        top: `${(i * 53) % 100}%`,
        scale: 1.2 + ((i * 7) % 9) / 10,
        rotate: ((i * 29) % 24) - 12,
        opacity: 0.08 + ((i * 3) % 5) * 0.02,
      })
    }

    return decorations
  }, [blockSprites])

  const propertyInfo = useMemo(() => {
    if (!data) return {}
    return TARGET_PROPERTIES.reduce((acc, pid) => {
      const prop = data.properties[pid]
      acc[pid] = {
        name: prop?.property_name ?? getPropertySchema(pid).label ?? pid,
        description: prop?.property_description ?? '',
      }
      return acc
    }, {})
  }, [data])

  const criterionPool = useMemo(() => buildCriterionPool(blocks), [blocks])

  const filteredBlocks = useMemo(() => {
    if (!blocks.length) return []
    const query = pickerQuery.toLowerCase().trim()
    if (!query) return blocks
    return blocks.filter((block) => block.name.toLowerCase().includes(query))
  }, [blocks, pickerQuery])

  const isGameOver = gameState === 'won' || gameState === 'lost'

  const blocksByName = useMemo(() => {
    const index = {}
    blocks.forEach((block) => {
      index[block.name] = block
    })
    return index
  }, [blocks])

  const getPossibleBlocksForCell = (cellIndex, excludeUsedBlocks = true) => {
    if (!Number.isInteger(cellIndex) || cellIndex < 0) return []

    const { rowIndex, colIndex } = getCellCoordinates(cellIndex)
    const rowCriterion = rowClues[rowIndex]
    const colCriterion = colClues[colIndex]
    const usedBlockNames = excludeUsedBlocks ? new Set(grid.filter(Boolean)) : new Set()

    return blocks.filter((block) => {
      if (excludeUsedBlocks && usedBlockNames.has(block.name) && grid[cellIndex] !== block.name) return false
      return evaluateCriterion(block, rowCriterion) && evaluateCriterion(block, colCriterion)
    })
  }

  const possibleCountsByCell = useMemo(() => {
    if (!blocks.length) return Array(GRID_SIZE * GRID_SIZE).fill(0)

    const usedBlockNames = new Set(grid.filter(Boolean))

    return Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, cellIndex) => {
      if (grid[cellIndex]) return null

      const { rowIndex, colIndex } = getCellCoordinates(cellIndex)
      const rowCriterion = rowClues[rowIndex]
      const colCriterion = colClues[colIndex]

      return blocks.filter((block) => {
        if (usedBlockNames.has(block.name)) return false
        return evaluateCriterion(block, rowCriterion) && evaluateCriterion(block, colCriterion)
      }).length
    })
  }, [blocks, grid, rowClues, colClues])

  useEffect(() => {
    if (!blocks.length || !criterionPool.length) return
    const seedBase = new Date(seed).getTime() / 1000
    const puzzleBlocks = []

    const countMatches = (criterion) =>
      blocks.reduce((count, block) => count + (evaluateCriterion(block, criterion) ? 1 : 0), 0)

    const criteriaSource = criterionPool

    const sampleDistinctCriteria = (pool, count, seedOffset) => {
      const available = [...pool]
      const sampled = []

      for (let i = 0; sampled.length < count && available.length; i += 1) {
        const idx = randomIndex(seedBase + seedOffset + i * 13.37, available.length)
        sampled.push(available[idx])
        available.splice(idx, 1)
      }

      return sampled
    }

    const shuffleDeterministic = (array, seedOffset) => {
      const copy = [...array]
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = randomIndex(seedBase + seedOffset + i * 19.97, i + 1)
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
      }
      return copy
    }

    const groupCriteriaBySelectionKey = (criteria) => {
      const groups = new Map()

      criteria.forEach((criterion) => {
        const selectionKey = criterion.selectionKey ?? criterion.propertyId ?? criterion.kind
        if (!groups.has(selectionKey)) {
          groups.set(selectionKey, [])
        }
        groups.get(selectionKey).push(criterion)
      })

      return Array.from(groups.entries()).map(([selectionKey, groupCriteria]) => ({
        selectionKey,
        criteria: groupCriteria,
      }))
    }

    let selectedRows = []
    let selectedCols = []
    let selectedCellCandidates = null
    let bestMinCount = -1

    for (let attempt = 0; attempt < MAX_GRID_GENERATION_ATTEMPTS; attempt += 1) {
      const groupedCriteria = groupCriteriaBySelectionKey(criteriaSource)
        .map((group) => {
          const broadCriteria = group.criteria.filter((criterion) => countMatches(criterion) >= MIN_CRITERION_MATCHES)
          return {
            selectionKey: group.selectionKey,
            criteria: broadCriteria.length ? broadCriteria : group.criteria,
          }
        })
        .filter((group) => group.criteria.length)

      if (groupedCriteria.length < GRID_SIZE * 2) {
        continue
      }

      const selectedGroups = sampleDistinctCriteria(groupedCriteria, GRID_SIZE * 2, attempt * 101 + 9)
      const sampled = shuffleDeterministic(
        selectedGroups.map((group, groupIndex) => group.criteria[randomIndex(seedBase + attempt * 31 + groupIndex * 7 + 1, group.criteria.length)]),
        attempt * 103 + 3,
      )

      if (sampled.length < GRID_SIZE * 2) continue

      const rowCluesAttempt = sampled.slice(0, GRID_SIZE)
      const colCluesAttempt = sampled.slice(GRID_SIZE)

      const cellCandidates = []
      let minCount = Number.POSITIVE_INFINITY

      for (let r = 0; r < GRID_SIZE; r += 1) {
        cellCandidates[r] = []
        for (let c = 0; c < GRID_SIZE; c += 1) {
          const candidates = blocks.filter(
            (block) => evaluateCriterion(block, rowCluesAttempt[r]) && evaluateCriterion(block, colCluesAttempt[c]),
          )
          cellCandidates[r][c] = candidates
          if (candidates.length < minCount) {
            minCount = candidates.length
          }
        }
      }

      if (minCount > bestMinCount) {
        bestMinCount = minCount
        selectedRows = rowCluesAttempt
        selectedCols = colCluesAttempt
        selectedCellCandidates = cellCandidates
      }

      if (minCount >= MIN_POSSIBLE_ANSWERS_PER_CELL) {
        break
      }
    }

    if (!selectedRows.length || !selectedCols.length) {
      const fallbackGroups = groupCriteriaBySelectionKey(criteriaSource)
      const fallback = shuffleDeterministic(
        sampleDistinctCriteria(fallbackGroups, GRID_SIZE * 2, 999).map((group, groupIndex) => {
          const broadCriteria = group.criteria.filter((criterion) => countMatches(criterion) >= MIN_CRITERION_MATCHES)
          const candidates = broadCriteria.length ? broadCriteria : group.criteria
          return candidates[randomIndex(seedBase + 999 + groupIndex * 5, candidates.length)]
        }),
        1001,
      )

      selectedRows = fallback.slice(0, GRID_SIZE)
      selectedCols = fallback.slice(GRID_SIZE)
      selectedCellCandidates = null
    }

    for (let r = 0; r < GRID_SIZE; r += 1) {
      for (let c = 0; c < GRID_SIZE; c += 1) {
        const candidates =
          selectedCellCandidates?.[r]?.[c] ??
          blocks.filter((block) => evaluateCriterion(block, selectedRows[r]) && evaluateCriterion(block, selectedCols[c]))
        puzzleBlocks.push(randomFrom(candidates.length ? candidates : blocks, seedBase + r * GRID_SIZE + c))
      }
    }

    setPuzzle({ rowClues: selectedRows, colClues: selectedCols, blocks: puzzleBlocks })
    setGrid(Array(GRID_SIZE * GRID_SIZE).fill(null))
    setErrorCount(0)
    setScore(0)
    setTryCount(1)
    setGameState('playing')
    setFeedbackMessage('')
    setPickerOpen(false)
    setPickerMode('pick')
    setPickerQuery('')
    setPossibleAnswers([])
    setActiveCellIndex(null)
    restoredStateSeedRef.current = null
  }, [blocks, criterionPool, seed])

  useEffect(() => {
    const hasPuzzle = rowClues.every(Boolean) && colClues.every(Boolean)
    if (!hasPuzzle || !blocks.length) return
    if (restoredStateSeedRef.current === seed) return

    restoredStateSeedRef.current = seed

    const knownBlockNames = new Set(blocks.map((block) => block.name))
    const storageKey = getGameStateStorageKey(seed)
    const cachedState = parseCachedGameState(localStorage.getItem(storageKey), knownBlockNames)

    if (!cachedState) return

    setGrid(cachedState.grid)
    setErrorCount(cachedState.errorCount)
    setScore(cachedState.score)
    setTryCount(cachedState.tryCount)
    setGameState(cachedState.gameState)
    setFeedbackMessage(cachedState.feedbackMessage)
    setActiveCellIndex(null)
    setPickerOpen(false)
    setPickerMode('pick')
    setPickerQuery('')
    setPossibleAnswers([])
  }, [blocks, colClues, rowClues, seed])

  useEffect(() => {
    if (status !== 'ready') return
    if (restoredStateSeedRef.current !== seed) return

    const storageKey = getGameStateStorageKey(seed)
    const payload = {
      grid,
      errorCount,
      score,
      tryCount,
      gameState,
      feedbackMessage,
      updatedAt: new Date().toISOString(),
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify(payload))
    } catch {
      // Ignore storage errors so gameplay is not blocked.
    }
  }, [errorCount, feedbackMessage, gameState, grid, score, seed, status, tryCount])

  useEffect(() => {
    if (!flashCell) return

    const timeoutId = setTimeout(() => {
      setFlashCell(null)
    }, 450)

    return () => clearTimeout(timeoutId)
  }, [flashCell])

  useEffect(() => {
    if (gameState === 'won' || gameState === 'lost') {
      setResultPopupOpen(true)
      setShareFeedbackMessage('')
      setShareFallbackText('')
    }
  }, [gameState])

  const copyTextToClipboard = async (text) => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        // Fall through to legacy copy fallback.
      }
    }

    let textArea = null

    try {
      textArea = document.createElement('textarea')
      textArea.value = text
      textArea.setAttribute('readonly', '')
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      textArea.style.pointerEvents = 'none'
      textArea.style.top = '-9999px'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      textArea.setSelectionRange(0, textArea.value.length)
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      if (textArea && textArea.parentNode) {
        textArea.parentNode.removeChild(textArea)
      }
    }
  }

  const buildShareMessage = () => {
    const seedUrl = new URL(window.location.href)
    seedUrl.searchParams.set('seed', seed)
    const outcomeLabel = gameState === 'won' ? 'Victory' : 'Defeat'

    return [
      `Minecraftdoku ${outcomeLabel}`,
      `Score: ${score}`,
      `Errors: ${errorCount}/${MAX_ERRORS}`,
      `Tries today: ${tryCount}`,
      `Result: ${gameState === 'won' ? 'Won' : 'Lost'}`,
      `Seed: ${seed}`,
      seedUrl.toString(),
    ].join('\n')
  }

  const handleCellClick = (index) => {
    if (gameState === 'lost') {
      const answers = getPossibleBlocksForCell(index, false)
      setPossibleAnswers(answers)
      setActiveCellIndex(index)
      setPickerMode('answers')
      setPickerQuery('')
      setPickerOpen(true)
      return
    }

    if (isGameOver) return
    if (grid[index]) return
    setActiveCellIndex(index)
    setPickerMode('pick')
    setPickerOpen(true)
  }

  const handleSelectForCell = (blockName) => {
    if (activeCellIndex === null) return

    if (isGameOver) return

    const selectedBlock = blocksByName[blockName]
    if (!selectedBlock) return

    const alreadyUsed = grid.some((value, idx) => value === blockName && idx !== activeCellIndex)
    if (alreadyUsed) {
      setFeedbackMessage(`'${blockName}' is already used in the grid.`)
      setFlashCell({ index: activeCellIndex, token: Date.now() })
      setPickerOpen(false)
      setPickerMode('pick')
      setPickerQuery('')
      setActiveCellIndex(null)
      return
    }

    const { rowIndex, colIndex } = getCellCoordinates(activeCellIndex)
    const rowCriterion = rowClues[rowIndex]
    const colCriterion = colClues[colIndex]

    const isValidForRow = evaluateCriterion(selectedBlock, rowCriterion)
    const isValidForCol = evaluateCriterion(selectedBlock, colCriterion)

    if (!isValidForRow || !isValidForCol) {
      const nextErrors = errorCount + 1
      const failureReasons = []

      if (!isValidForRow) {
        failureReasons.push(describeCriterionFailure(selectedBlock, rowCriterion, 'Row', propertyInfo))
      }
      if (!isValidForCol) {
        failureReasons.push(describeCriterionFailure(selectedBlock, colCriterion, 'Column', propertyInfo))
      }

      setErrorCount(nextErrors)
      setFeedbackMessage(`'${blockName}' is invalid. ${failureReasons.join(' ')}`)
      setFlashCell({ index: activeCellIndex, token: Date.now() })
      setPickerOpen(false)
      setPickerMode('pick')
      setPickerQuery('')
      setActiveCellIndex(null)
      if (nextErrors >= MAX_ERRORS) {
        setGameState('lost')
      }
      return
    }

    const nextGrid = grid.map((value, idx) => (idx === activeCellIndex ? blockName : value))
    const awardedPoints = selectedBlock.rarityPoints ?? 1
    const nextScore = score + awardedPoints

    setGrid(nextGrid)
    setScore(nextScore)
    setFeedbackMessage(
      `'${blockName}' placed successfully (+${awardedPoints} pts, ${formatRarityLabel(selectedBlock.rarityScore)}).`,
    )
    setPickerOpen(false)
    setPickerMode('pick')
    setPickerQuery('')

    if (nextGrid.every(Boolean)) {
      setGameState('won')
      setActiveCellIndex(null)
      return
    }

    setActiveCellIndex(null)
  }

  const handleReset = () => {
    const nextTryCount = tryCount + 1
    setGrid(Array(GRID_SIZE * GRID_SIZE).fill(null))
    setErrorCount(0)
    setScore(0)
    setTryCount(nextTryCount)
    setGameState('playing')
    setFeedbackMessage('')
    setResultPopupOpen(false)
    setShareFeedbackMessage('')
    setShareFallbackText('')
    setActiveCellIndex(null)
    setPickerOpen(false)
    setPickerMode('pick')
    setPickerQuery('')
    setPossibleAnswers([])
  }

  const handleCopySeedLink = async () => {
    const url = new URL(window.location.href)
    url.searchParams.set('seed', seed)
    const text = url.toString()

    const copied = await copyTextToClipboard(text)

    if (copied) {
      setFeedbackMessage('Seed link copied.')
    } else {
      setFeedbackMessage(`Seed link: ${text}`)
    }
  }

  const handleShareResult = async () => {
    const shareMessage = buildShareMessage()

    const copied = await copyTextToClipboard(shareMessage)

    if (copied) {
      setShareFeedbackMessage('Result copied to clipboard.')
      setShareFallbackText('')
    } else {
      setShareFeedbackMessage('Copy failed on this browser. Select and copy manually below.')
      setShareFallbackText(shareMessage)
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <p className="text-xl font-semibold">Loading Minecraft block data…</p>
          <p className="text-slate-500">This may take a moment on first load.</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <p className="text-xl font-semibold">Failed to load block data.</p>
          <p className="text-slate-500">Check your network or try again later.</p>
        </div>
      </div>
    )
  }

  const getSpriteForBlock = (blockName) => blockSprites[blockName] ?? null

  return (
    <div className="mc-ui min-h-screen bg-[#f7f9ff] text-[#1a2033] px-3 py-4 sm:px-4 sm:py-6 md:py-8">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
        {decorativeSprites.map((item) => (
          <span
            key={item.id}
            className={`mc-sprite ${item.sprite.sheet}`}
            style={{
              backgroundPosition: `${item.sprite.x}px ${item.sprite.y}px`,
              position: 'absolute',
              left: item.left,
              top: item.top,
              transform: `translate(-50%, -50%) scale(${item.scale}) rotate(${item.rotate}deg)`,
              opacity: item.opacity,
              filter: 'saturate(0.7) contrast(0.95)',
            }}
          />
        ))}
      </div>

      <div className="mx-auto w-full max-w-[920px] space-y-2">
        <header className="border-b border-slate-200 pb-2">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h1 className="mc-title">{UI_TEXT.title}</h1>
              <button
                type="button"
                onClick={() => setV2PopupOpen(true)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-bold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                aria-haspopup="dialog"
              >
                V2
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <p className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
                Daily seed: {seed}
              </p>
              <button
                type="button"
                onClick={handleCopySeedLink}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700"
              >
                Copy seed link
              </button>
            </div>
          </div>
        </header>

        <div className="min-h-8 text-sm font-semibold sm:text-base">
          {gameState === 'won' && <p className="text-emerald-700">Victory! Grid completed.</p>}
          {gameState === 'lost' && (
            <div className="space-y-1">
              <p className="text-rose-700">Defeat. You reached 3 errors.</p>
              <p className="text-slate-700">Click any cell to view the possible valid answers for that case.</p>
            </div>
          )}
          {isGameOver && (
            <button
              type="button"
              onClick={handleReset}
              className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700"
            >
              Retry today
            </button>
          )}
          {gameState === 'playing' && feedbackMessage && <p className="text-slate-700">{feedbackMessage}</p>}
        </div>

        <section>
          <div
            className="grid gap-2 sm:gap-3"
            style={{ gridTemplateColumns: `minmax(84px, 1fr) repeat(${GRID_SIZE}, minmax(0, 1fr))` }}
          >
            <div className="aspect-square" />
            {colClues.map((criterion, index) => (
              <div
                key={`col-header-${index}`}
                className="relative flex aspect-square items-center justify-center rounded-2xl border border-[#e4ebfb] bg-[#f2f6ff] px-2 text-center sm:rounded-3xl sm:px-4"
              >
                <p className="text-[12px] font-bold leading-tight text-slate-800 sm:text-base md:text-lg">{formatCriterionLabel(criterion, propertyInfo)}</p>
              </div>
            ))}

            {Array.from({ length: GRID_SIZE }).map((_, r) => (
              <Fragment key={`row-${r}`}>
                <div className="relative flex aspect-square items-center justify-center rounded-2xl border border-[#e4ebfb] bg-[#f2f6ff] px-2 text-center sm:rounded-3xl sm:px-4">
                  <p className="text-[12px] font-bold leading-tight text-slate-800 sm:text-base md:text-lg">{formatCriterionLabel(rowClues[r], propertyInfo)}</p>
                </div>
                {Array.from({ length: GRID_SIZE }).map((_, c) => {
                  const idx = r * GRID_SIZE + c
                  return (
                    <button
                      key={`cell-${idx}`}
                      type="button"
                      onClick={() => handleCellClick(idx)}
                      className={`aspect-square rounded-2xl border-[3px] border-slate-800 bg-white p-2 text-left transition hover:scale-[1.01] sm:rounded-3xl sm:p-3 ${flashCell?.index === idx ? 'cell-error-flash' : ''}`}
                    >
                      {grid[idx] ? (
                        <div className="flex items-start gap-2">
                          <BlockIcon sprite={getSpriteForBlock(grid[idx])} className="mt-0.5 shrink-0" />
                          <p className="line-clamp-3 text-[11px] font-semibold leading-tight text-slate-800 sm:text-sm md:text-base">{grid[idx]}</p>
                        </div>
                      ) : (
                        <div>
                          {gameState === 'lost' ? (
                            <p className="text-[11px] font-semibold text-slate-700 sm:text-sm md:text-base">View valid answers</p>
                          ) : (
                            <>
                              <p className="text-[11px] font-semibold text-slate-700 sm:text-sm md:text-base">
                                {formatPossibleCount(possibleCountsByCell[idx] ?? 0)}
                              </p>
                              <p className="text-[10px] font-semibold text-slate-400 sm:text-xs md:text-sm">Tap to answer</p>
                            </>
                          )}
                        </div>
                      )}
                    </button>
                  )
                })}
              </Fragment>
            ))}
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <p className="text-sm font-semibold text-slate-600 sm:text-base">Author: Team23</p>
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-base font-bold text-slate-800 sm:text-lg">
            Score: {score}
          </div>
          <div className="flex items-center gap-3 text-lg font-semibold text-slate-800 sm:text-xl">
            <span>Errors</span>
            <div className="flex gap-2">
              {Array.from({ length: MAX_ERRORS }).map((_, idx) => (
                <span
                  key={`error-dot-${idx}`}
                  className={`error-cube h-6 w-6 sm:h-7 sm:w-7 ${idx < errorCount ? 'error-cube-filled' : ''}`}
                />
              ))}
            </div>
          </div>
        </footer>
      </div>

      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/35 px-4 py-10" role="dialog" aria-modal="true">
          <div className="mx-auto w-full max-w-[760px] rounded-3xl bg-white p-6 shadow-2xl">
            {pickerMode === 'pick' && (
              <>
                <label htmlFor="block-search" className="sr-only">
                  Search block
                </label>
                <input
                  id="block-search"
                  value={pickerQuery}
                  onChange={(event) => setPickerQuery(event.target.value)}
                  placeholder="Type a block..."
                  autoFocus
                  className="w-full border-b-2 border-slate-700 px-1 py-1 text-xl font-medium text-slate-900 outline-none sm:text-3xl"
                />
              </>
            )}

            {pickerMode === 'answers' && (
              <div className="border-b-2 border-slate-200 pb-3">
                <p className="text-lg font-bold text-slate-900 sm:text-2xl">Possible answers for this cell</p>
                <p className="mt-1 text-sm text-slate-600 sm:text-base">{possibleAnswers.length} valid blocks for this row and column criteria.</p>
              </div>
            )}

            <div className="mt-8 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {pickerMode === 'pick' &&
                filteredBlocks.map((block) => (
                  <button
                    key={block.name}
                    type="button"
                    onClick={() => handleSelectForCell(block.name)}
                    className="flex w-full items-center justify-between gap-4 rounded-2xl border border-transparent px-1 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-3">
                      <BlockIcon sprite={getSpriteForBlock(block.name)} className="shrink-0" />
                      <p className="text-base font-bold text-slate-800 sm:text-2xl">{block.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{formatRarityLabel(block.rarityScore)}</p>
                      <p className="text-sm font-bold text-emerald-700">+{block.rarityPoints} pts</p>
                    </div>
                  </button>
                ))}

              {pickerMode === 'pick' && filteredBlocks.length === 0 && (
                <p className="text-sm text-slate-500 sm:text-lg">No blocks found.</p>
              )}

              {pickerMode === 'answers' &&
                [...possibleAnswers]
                  .sort((a, b) => b.rarityScore - a.rarityScore || a.name.localeCompare(b.name))
                  .map((block) => (
                    <div key={block.name} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 px-2 py-2">
                      <div className="flex items-center gap-3">
                        <BlockIcon sprite={getSpriteForBlock(block.name)} className="shrink-0" />
                        <p className="text-base font-bold text-slate-800 sm:text-xl">{block.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{formatRarityLabel(block.rarityScore)}</p>
                        <p className="text-sm font-bold text-emerald-700">+{block.rarityPoints} pts</p>
                      </div>
                    </div>
                  ))}

              {pickerMode === 'answers' && possibleAnswers.length === 0 && (
                <p className="text-sm text-slate-500 sm:text-lg">No valid answers found for this cell.</p>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setPickerOpen(false)
                  setPickerMode('pick')
                  setPickerQuery('')
                  setPossibleAnswers([])
                }}
                className="px-4 py-2 text-lg font-semibold text-slate-600"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {v2PopupOpen && (
        <div className="fixed inset-0 z-[55] bg-slate-900/35 px-4 py-10" role="dialog" aria-modal="true" aria-labelledby="v2-features-title">
          <div className="mx-auto w-full max-w-[560px] rounded-3xl border-2 border-slate-200 bg-white p-6 shadow-2xl sm:p-7">
            <div className="space-y-4">
              <div className="inline-flex rounded-full border border-slate-300 px-3 py-1 text-xs font-extrabold tracking-[0.18em] text-slate-700">
                VERSION 2
              </div>
              <h2 id="v2-features-title" className="text-2xl font-extrabold text-slate-900 sm:text-3xl">
                New features in V2
              </h2>
              <ul className="list-disc space-y-2 pl-6 text-base font-semibold text-slate-700 sm:text-lg">
                <li>Rarity score for each block to reward harder picks.</li>
                <li>Cached each player&apos;s daily progress so games continue after refresh.</li>
                <li>More block criterion variety for richer row and column clues.</li>
              </ul>
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setV2PopupOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {resultPopupOpen && isGameOver && (
        <div className="fixed inset-0 z-[60] bg-slate-900/45 px-4 py-10" role="dialog" aria-modal="true" aria-labelledby="game-result-title">
          <div className="mx-auto w-full max-w-[520px] rounded-3xl border-2 border-slate-200 bg-white p-6 shadow-2xl sm:p-7">
            <div className="space-y-4 text-center">
              <div className="mx-auto inline-flex rounded-full border-2 border-slate-300 px-4 py-1 text-xs font-extrabold tracking-[0.22em] text-slate-700">
                {gameState === 'won' ? 'VICTORY' : 'DEFEAT'}
              </div>
              <h2 id="game-result-title" className={`text-3xl font-extrabold sm:text-4xl ${gameState === 'won' ? 'text-emerald-700' : 'text-rose-700'}`}>
                {gameState === 'won' ? 'You completed the grid' : 'Three errors reached'}
              </h2>
              <p className="text-base font-semibold text-slate-700 sm:text-lg">
                Final score {score} • Errors {errorCount}/{MAX_ERRORS}
              </p>
              <p className="text-sm font-semibold text-slate-600 sm:text-base">Try #{tryCount} today</p>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleShareResult}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 sm:text-base"
                >
                  Share result
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 sm:text-base"
                >
                  Retry today
                </button>
                <button
                  type="button"
                  onClick={() => setResultPopupOpen(false)}
                  className="rounded-lg border border-transparent px-4 py-2 text-sm font-bold text-slate-600 sm:text-base"
                >
                  Close
                </button>
              </div>
              {shareFeedbackMessage && <p className="text-sm font-semibold text-slate-600">{shareFeedbackMessage}</p>}
              {shareFallbackText && (
                <textarea
                  readOnly
                  value={shareFallbackText}
                  className="mt-1 min-h-32 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-left text-sm font-medium text-slate-800"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
