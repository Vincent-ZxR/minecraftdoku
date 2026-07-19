import { Fragment, useEffect, useMemo, useState } from 'react'

const LOCAL_BLOCK_DATA_URL = '/data/block_data.json'
const REMOTE_BLOCK_DATA_URL = 'https://raw.githubusercontent.com/JoakimThorsen/MCPropertyEncyclopedia/main/data/block_data.json'
const TARGET_PROPERTIES = ['hardness', 'blast_resistance', 'requires_tool', 'blocks_motion', 'blocks_light', 'material']
const GRID_SIZE = 3
const EMPTY_PUZZLE = {
  rowClues: Array(GRID_SIZE).fill(null),
  colClues: Array(GRID_SIZE).fill(null),
  blocks: [],
}

const UI_TEXT = {
  title: 'minecraftdoku',
  dayTitle: 'grille du jour',
}

function randomFrom(array, seed) {
  if (!array.length) return null
  const x = Math.sin(seed) * 10000
  const idx = Math.floor((x - Math.floor(x)) * array.length)
  return array[idx]
}

function normalizeValue(value) {
  if (typeof value === 'string') return value.toLowerCase()
  if (typeof value === 'number') return value
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  return value
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
  const [seed, setSeed] = useState(() => new Date().toISOString().slice(0, 10))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeCellIndex, setActiveCellIndex] = useState(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const [errorCount] = useState(0)

  const rowClues = puzzle?.rowClues ?? EMPTY_PUZZLE.rowClues
  const colClues = puzzle?.colClues ?? EMPTY_PUZZLE.colClues

  useEffect(() => {
    fetchJsonWithFallback()
      .then((json) => {
        setData(json)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [])

  const blocks = useMemo(() => {
    if (!data) return []
    return data.key_list.map((name) => {
      const block = { name }
      TARGET_PROPERTIES.forEach((pid) => {
        const prop = data.properties[pid]
        if (!prop) {
          block[pid] = null
          return
        }
        block[pid] = prop.entries[name] ?? prop.default_value
      })
      return block
    })
  }, [data])

  const propertyInfo = useMemo(() => {
    if (!data) return {}
    return TARGET_PROPERTIES.reduce((acc, pid) => {
      const prop = data.properties[pid]
      if (!prop) return acc
      acc[pid] = {
        name: prop.property_name,
        description: prop.property_description,
      }
      return acc
    }, {})
  }, [data])

  const filteredBlocks = useMemo(() => {
    if (!blocks.length) return []
    const query = pickerQuery.toLowerCase().trim()
    if (!query) return blocks
    return blocks.filter((block) => block.name.toLowerCase().includes(query))
  }, [blocks, pickerQuery])

  const score = useMemo(() => {
    const filledCells = grid.filter(Boolean).length
    return filledCells * 100
  }, [grid])

  useEffect(() => {
    if (!blocks.length) return
    const seedBase = new Date(seed).getTime() / 1000
    const clueProps = TARGET_PROPERTIES.slice(0, GRID_SIZE * 2)
    const puzzleBlocks = []
    const rowClues = []
    const colClues = []

    for (let i = 0; i < GRID_SIZE; i += 1) {
      rowClues.push(clueProps[i])
      colClues.push(clueProps[i + GRID_SIZE])
    }

    for (let r = 0; r < GRID_SIZE; r += 1) {
      for (let c = 0; c < GRID_SIZE; c += 1) {
        const rowPid = rowClues[r]
        const colPid = colClues[c]
        const candidates = blocks.filter((block) => {
          const rowVal = normalizeValue(block[rowPid])
          const colVal = normalizeValue(block[colPid])
          return rowVal !== null && colVal !== null
        })
        puzzleBlocks.push(randomFrom(candidates, seedBase + r * GRID_SIZE + c))
      }
    }

    setPuzzle({ rowClues, colClues, blocks: puzzleBlocks })
    setGrid(Array(GRID_SIZE * GRID_SIZE).fill(null))
  }, [blocks, seed])

  const handleCellClick = (index) => {
    setActiveCellIndex(index)
    setPickerOpen(true)
  }

  const handleSelectForCell = (blockName) => {
    if (activeCellIndex === null) return
    setGrid((prev) => prev.map((value, idx) => (idx === activeCellIndex ? blockName : value)))
    setPickerOpen(false)
    setPickerQuery('')
  }

  const handleReset = () => {
    setGrid(Array(GRID_SIZE * GRID_SIZE).fill(null))
    setActiveCellIndex(null)
    setPickerOpen(false)
    setPickerQuery('')
  }

  const handleNewPuzzle = () => {
    const today = new Date().toISOString().slice(0, 10)
    setSeed(today)
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

  const frenchDate = new Date(seed).toLocaleDateString('fr-FR')

  return (
    <div className="min-h-screen bg-[#f7f9ff] text-[#1a2033] px-3 py-4 sm:px-4 sm:py-6 md:py-8">
      <div className="mx-auto w-full max-w-[920px] space-y-4">
        <header className="border-b border-slate-200 pb-4">
          <h1 className="text-4xl font-black lowercase tracking-tight sm:text-5xl">{UI_TEXT.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-3 uppercase tracking-[0.08em] text-slate-700">
            <span className="text-sm sm:text-base">FAQ</span>
            <span className="text-sm sm:text-base">BLOG</span>
            <span className="text-sm sm:text-base">ARCHIVES</span>
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-800 px-3 py-1 text-sm font-bold text-white sm:text-base">
              11
            </span>
          </div>
        </header>

        <div className="flex items-end justify-between gap-4 pt-1">
          <div>
            <p className="text-xl font-bold lowercase sm:text-2xl">{UI_TEXT.dayTitle}</p>
            <p className="text-2xl font-extrabold sm:text-3xl">{frenchDate}</p>
          </div>
          <p className="text-xl font-bold sm:text-2xl">Score : {score}/900</p>
        </div>

        <section>
          <div
            className="grid gap-2 sm:gap-3"
            style={{ gridTemplateColumns: 'minmax(84px, 1fr) repeat(3, minmax(0, 1fr))' }}
          >
            <div className="aspect-square" />
            {colClues.map((pid, index) => (
              <div
                key={`col-header-${pid || index}`}
                className="relative flex aspect-square items-center justify-center rounded-2xl border border-[#e4ebfb] bg-[#f2f6ff] px-2 text-center sm:rounded-3xl sm:px-4"
              >
                <span className="absolute right-2 top-1 text-xs text-slate-400 sm:right-3 sm:top-2 sm:text-lg">?</span>
                <p className="text-[12px] font-bold leading-tight text-slate-800 sm:text-base md:text-lg">{propertyInfo[pid]?.name || pid || '...'}</p>
              </div>
            ))}

            {Array.from({ length: GRID_SIZE }).map((_, r) => (
              <Fragment key={`row-${r}`}>
                <div className="relative flex aspect-square items-center justify-center rounded-2xl border border-[#e4ebfb] bg-[#f2f6ff] px-2 text-center sm:rounded-3xl sm:px-4">
                  <span className="absolute right-2 top-1 text-xs text-slate-400 sm:right-3 sm:top-2 sm:text-lg">?</span>
                  <p className="text-[12px] font-bold leading-tight text-slate-800 sm:text-base md:text-lg">{propertyInfo[rowClues[r]]?.name || rowClues[r] || '...'}</p>
                </div>
                {Array.from({ length: GRID_SIZE }).map((_, c) => {
                  const idx = r * GRID_SIZE + c
                  return (
                    <button
                      key={`cell-${idx}`}
                      type="button"
                      onClick={() => handleCellClick(idx)}
                      className="aspect-square rounded-2xl border-[3px] border-slate-800 bg-white p-2 text-left transition hover:scale-[1.01] sm:rounded-3xl sm:p-3"
                    >
                      {grid[idx] ? (
                        <p className="line-clamp-3 text-[11px] font-semibold leading-tight text-slate-800 sm:text-sm md:text-base">{grid[idx]}</p>
                      ) : (
                        <p className="text-[11px] font-semibold text-slate-400 sm:text-sm md:text-base">Select</p>
                      )}
                    </button>
                  )
                })}
              </Fragment>
            ))}
          </div>
        </section>

        <footer className="flex flex-col items-start justify-between gap-3 border-t border-slate-200 pt-4 lg:flex-row lg:items-center">
          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <button
              type="button"
              onClick={handleReset}
              className="w-full rounded-none border-[3px] border-slate-700 px-4 py-3 text-base font-semibold text-slate-800 sm:w-auto sm:text-lg"
            >
              Abandonner et voir les solutions
            </button>
            <button
              type="button"
              onClick={handleNewPuzzle}
              className="w-full rounded-none border-[3px] border-slate-700 px-4 py-3 text-base font-semibold text-slate-800 sm:w-auto sm:text-lg"
            >
              Nouvelle grille
            </button>
          </div>
          <div className="flex items-center gap-3 text-lg font-semibold text-slate-800 sm:text-xl">
            <span>Erreurs</span>
            <div className="flex gap-2">
              {Array.from({ length: 3 }).map((_, idx) => (
                <span
                  key={`error-dot-${idx}`}
                  className={`h-6 w-6 rounded-full border-[3px] border-slate-800 sm:h-7 sm:w-7 ${idx < errorCount ? 'bg-slate-800' : 'bg-white'}`}
                />
              ))}
            </div>
          </div>
        </footer>
      </div>

      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/35 px-4 py-10" role="dialog" aria-modal="true">
          <div className="mx-auto w-full max-w-[760px] rounded-3xl bg-white p-6 shadow-2xl">
            <label htmlFor="block-search" className="sr-only">
              Search block
            </label>
            <input
              id="block-search"
              value={pickerQuery}
              onChange={(event) => setPickerQuery(event.target.value)}
              placeholder="Tape un bloc..."
              autoFocus
              className="w-full border-b-2 border-slate-700 px-1 py-1 text-xl font-medium text-slate-900 outline-none sm:text-3xl"
            />
            <div className="mt-8 space-y-3">
              {filteredBlocks.slice(0, 8).map((block) => (
                <div key={block.name} className="flex items-center justify-between gap-4 rounded-2xl px-1 py-2">
                  <p className="text-base font-bold text-slate-800 sm:text-2xl">{block.name}</p>
                  <button
                    type="button"
                    onClick={() => handleSelectForCell(block.name)}
                    className="bg-[#160ca8] px-3 py-2 text-sm font-bold text-white sm:px-5 sm:py-3 sm:text-xl"
                  >
                    Choisir
                  </button>
                </div>
              ))}
              {filteredBlocks.length === 0 && <p className="text-sm text-slate-500 sm:text-lg">Aucun bloc trouve.</p>}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setPickerOpen(false)
                  setPickerQuery('')
                }}
                className="px-4 py-2 text-lg font-semibold text-slate-600"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
