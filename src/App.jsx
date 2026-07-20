import { Fragment, useEffect, useMemo, useState } from 'react'
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
const REQUIRED_PROPERTY_IDS = ['hardness', 'blast_resistance', 'emits_power', 'material_is_opaque']
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

function isValidSeedDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime())
}

function getSeedFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const urlSeed = params.get('seed')
  if (!urlSeed) return null
  return isValidSeedDate(urlSeed) ? urlSeed : null
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

  const value = block[criterion.propertyId]

  if (criterion.kind === 'number' && isFiniteNumber(value)) {
    if (criterion.operator === 'gt') return value > criterion.threshold
    if (criterion.operator === 'lt') return value < criterion.threshold
    return false
  }

  if (criterion.kind === 'boolean') {
    return value === criterion.expected
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

  const propLabel = propertyInfo[criterion.propertyId]?.name ?? criterion.label ?? criterion.propertyId

  if (criterion.kind === 'number') {
    const symbol = criterion.operator === 'lt' ? '<' : '>'
    return `${propLabel} ${symbol} ${formatNumber(criterion.threshold)}`
  }

  if (criterion.kind === 'boolean') {
    return `${propLabel} = ${criterion.expected ? 'Yes' : 'No'}`
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

function buildCriterionPool(blocks) {
  if (!blocks.length) return []

  const pool = []
  const hardnessValues = uniqueSortedNumbers(blocks.map((block) => block.hardness))
  const blastValues = uniqueSortedNumbers(blocks.map((block) => block.blast_resistance))

  const addNumericThresholdCriteria = (propertyId, values, label) => {
    if (values.length < 6) return
    const q1 = values[Math.floor(values.length * 0.3)]
    const q2 = values[Math.floor(values.length * 0.5)]
    const q3 = values[Math.floor(values.length * 0.7)]
    const thresholds = uniqueSortedNumbers([q1, q2, q3])

    thresholds.forEach((threshold) => {
      pool.push({ kind: 'number', propertyId, operator: 'gt', threshold, label })
      pool.push({ kind: 'number', propertyId, operator: 'lt', threshold, label })
    })
  }

  addNumericThresholdCriteria('hardness', hardnessValues, 'Hardness')
  addNumericThresholdCriteria('blast_resistance', blastValues, 'Blast Resistance')

  pool.push({ kind: 'boolean', propertyId: 'emits_power', expected: true, label: 'Emits Power' })
  pool.push({ kind: 'boolean', propertyId: 'emits_power', expected: false, label: 'Emits Power' })
  pool.push({ kind: 'boolean', propertyId: 'material_is_opaque', expected: true, label: 'Material is Opaque' })
  pool.push({ kind: 'boolean', propertyId: 'material_is_opaque', expected: false, label: 'Material is Opaque' })

  const letters = Array.from(
    new Set(
      blocks
        .map((block) => block.name[0]?.toLowerCase())
        .filter((char) => char && char >= 'a' && char <= 'z'),
    ),
  ).sort()

  letters.slice(0, 10).forEach((letter) => {
    pool.push({ kind: 'name_starts_with', letter })
  })

  ;['a', 'e', 'i', 'o', 'u', 's', 't', 'r'].forEach((letter) => {
    pool.push({ kind: 'name_contains', letter })
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
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [grid, setGrid] = useState(Array(GRID_SIZE * GRID_SIZE).fill(null))
  const [puzzle, setPuzzle] = useState(EMPTY_PUZZLE)
  const [seed, setSeed] = useState(() => getSeedFromUrl() ?? getTodaySeed())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerMode, setPickerMode] = useState('pick')
  const [activeCellIndex, setActiveCellIndex] = useState(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const [possibleAnswers, setPossibleAnswers] = useState([])
  const [errorCount, setErrorCount] = useState(0)
  const [gameState, setGameState] = useState('playing')
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [flashCell, setFlashCell] = useState(null)

  const rowClues = puzzle?.rowClues ?? EMPTY_PUZZLE.rowClues
  const colClues = puzzle?.colClues ?? EMPTY_PUZZLE.colClues

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    params.set('seed', seed)
    const nextQuery = params.toString()
    const nextUrl = `${window.location.pathname}?${nextQuery}${window.location.hash}`
    window.history.replaceState({}, '', nextUrl)
  }, [seed])

  useEffect(() => {
    const handlePopState = () => {
      const nextSeed = getSeedFromUrl() ?? getTodaySeed()
      if (nextSeed !== seed) {
        setSeed(nextSeed)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [seed])

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

    let selectedRows = []
    let selectedCols = []
    let selectedCellCandidates = null
    let bestMinCount = -1

    for (let attempt = 0; attempt < MAX_GRID_GENERATION_ATTEMPTS; attempt += 1) {
      const requiredCriteria = []
      let missingRequiredCriteria = false

      REQUIRED_PROPERTY_IDS.forEach((propertyId, propertyIdx) => {
        const propertyCandidates = criteriaSource.filter((criterion) => criterion.propertyId === propertyId)
        const broadPropertyCandidates = propertyCandidates.filter((criterion) => countMatches(criterion) >= MIN_CRITERION_MATCHES)
        const sourcePool = broadPropertyCandidates.length ? broadPropertyCandidates : propertyCandidates
        if (!propertyCandidates.length) {
          missingRequiredCriteria = true
          return
        }
        requiredCriteria.push(
          sourcePool[randomIndex(seedBase + attempt * 31 + propertyIdx * 7 + 1, sourcePool.length)],
        )
      })

      if (missingRequiredCriteria) {
        continue
      }

      const broadNameCriteria = criterionPool.filter(
        (criterion) => criterion.kind === 'name_contains' && countMatches(criterion) >= MIN_CRITERION_MATCHES,
      )
      const nameCriteriaPool = broadNameCriteria.length
        ? broadNameCriteria
        : criterionPool.filter((criterion) => criterion.kind === 'name_contains')

      const extraCriteriaCount = GRID_SIZE * 2 - requiredCriteria.length
      if (extraCriteriaCount < 0 || nameCriteriaPool.length < extraCriteriaCount) {
        continue
      }

      const extraCriteria = sampleDistinctCriteria(nameCriteriaPool, extraCriteriaCount, attempt * 101 + 9)
      const sampled = shuffleDeterministic([...requiredCriteria, ...extraCriteria], attempt * 103 + 3)

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
      const fallbackRequired = REQUIRED_PROPERTY_IDS.map((propertyId, idx) => {
        const propertyCandidates = criteriaSource.filter((criterion) => criterion.propertyId === propertyId)
        return propertyCandidates[randomIndex(seedBase + 999 + idx * 5, propertyCandidates.length)]
      }).filter(Boolean)
      const fallbackNamePool = criterionPool.filter((criterion) => criterion.kind === 'name_contains')
      const fallbackNames = sampleDistinctCriteria(fallbackNamePool, Math.max(0, GRID_SIZE * 2 - fallbackRequired.length), 999)
      const fallback = shuffleDeterministic([...fallbackRequired, ...fallbackNames], 1001)

      if (fallback.length < GRID_SIZE * 2) {
        const remaining = sampleDistinctCriteria(
          criteriaSource.filter((criterion) => !fallback.includes(criterion)),
          GRID_SIZE * 2 - fallback.length,
          1003,
        )
        fallback.push(...remaining)
      }

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
    setGameState('playing')
    setFeedbackMessage('')
    setPickerOpen(false)
    setPickerMode('pick')
    setPickerQuery('')
    setPossibleAnswers([])
    setActiveCellIndex(null)
  }, [blocks, criterionPool, seed])

  useEffect(() => {
    if (!flashCell) return

    const timeoutId = setTimeout(() => {
      setFlashCell(null)
    }, 450)

    return () => clearTimeout(timeoutId)
  }, [flashCell])

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
    setGrid(nextGrid)
    setFeedbackMessage(`'${blockName}' placed successfully.`)
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
    setGrid(Array(GRID_SIZE * GRID_SIZE).fill(null))
    setErrorCount(0)
    setGameState('playing')
    setFeedbackMessage('')
    setActiveCellIndex(null)
    setPickerOpen(false)
    setPickerMode('pick')
    setPickerQuery('')
    setPossibleAnswers([])
  }

  const handleSeedChange = (nextSeed) => {
    if (isValidSeedDate(nextSeed)) {
      setSeed(nextSeed)
      return
    }
    setSeed(getTodaySeed())
  }

  const handleRandomSeed = () => {
    const baseDate = new Date('2020-01-01T00:00:00.000Z')
    const offsetDays = randomIndex(Date.now(), 3650)
    baseDate.setUTCDate(baseDate.getUTCDate() + offsetDays)
    setSeed(baseDate.toISOString().slice(0, 10))
  }

  const handleCopySeedLink = async () => {
    const url = new URL(window.location.href)
    url.searchParams.set('seed', seed)
    const text = url.toString()

    if (!navigator.clipboard?.writeText) {
      setFeedbackMessage(`Seed link: ${text}`)
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      setFeedbackMessage('Seed link copied.')
    } catch {
      setFeedbackMessage(`Seed link: ${text}`)
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
            <h1 className="mc-title">{UI_TEXT.title}</h1>

            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="seed-date" className="text-sm font-semibold text-slate-700">
                Seed
              </label>
              <input
                id="seed-date"
                type="date"
                value={seed}
                onChange={(event) => handleSeedChange(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-800"
              />
              <button
                type="button"
                onClick={handleRandomSeed}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700"
              >
                Random
              </button>
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

        <footer className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
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
                  </button>
                ))}

              {pickerMode === 'pick' && filteredBlocks.length === 0 && (
                <p className="text-sm text-slate-500 sm:text-lg">No blocks found.</p>
              )}

              {pickerMode === 'answers' &&
                possibleAnswers.map((block) => (
                  <div key={block.name} className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 px-2 py-2">
                    <BlockIcon sprite={getSpriteForBlock(block.name)} className="shrink-0" />
                    <p className="text-base font-bold text-slate-800 sm:text-xl">{block.name}</p>
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
    </div>
  )
}

export default App
