import { createServer } from 'http'
import { Server } from 'socket.io'
import { db } from './db'

// --- Types ---
interface GoalEvent {
  fixtureId: string
  homeTeam: string
  awayTeam: string
  score: string
  minute: number
  status: string
  scoringTeam: 'home' | 'away'
  playerName: string
  homeScore: number
  awayScore: number
}

// --- DB connection status ---
let dbConnected = false

// --- HTTP Server with health check ---
const httpServer = createServer((req, res) => {
  if (req.url === '/health' || (req.url === '/' && req.method === 'GET')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'ok',
      service: 'goalzone-ws',
      port: parseInt(process.env.PORT || '3003', 10),
      clients: connectedClientCount,
      dataMode: process.env.DATA_MODE || 'mock',
      db: process.env.DATABASE_URL?.startsWith('postgres') ? 'PostgreSQL (Supabase)' : 'SQLite',
      dbConnected,
    }))
    return
  }
})

// --- Socket.IO Server ---
const io = new Server(httpServer, {
  path: '/socket.io/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// --- Previous match data cache ---
let prevMatchesMap = new Map<string, { homeScore: number; awayScore: number; status: string; minute: number }>()

// --- Status ordering for sort ---
const STATUS_ORDER: Record<string, number> = { LIVE: 0, HT: 1, UPCOMING: 2, FT: 3 }

// --- Fetch all matches from DB via Prisma ---
async function fetchMatchesFromDB() {
  const matches = await db.match.findMany()
  matches.sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99))
  return matches
}

async function fetchScorersFromDB() {
  return db.scorer.findMany({ orderBy: { goals: 'desc' } })
}

async function fetchStandingsFromDB(league: string = 'Premier League') {
  return db.standing.findMany({ where: { league }, orderBy: { position: 'asc' } })
}

function formatMatchData(matches: any[]) {
  return matches.map(m => {
    let events = []
    try { events = JSON.parse(m.events as string) } catch { events = [] }
    let homeForm = []
    try { homeForm = JSON.parse(m.homeForm as string) } catch { homeForm = [] }
    let awayForm = []
    try { awayForm = JSON.parse(m.awayForm as string) } catch { awayForm = [] }

    return {
      id: m.id,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      homeScore: m.homeScore as number,
      awayScore: m.awayScore as number,
      status: m.status,
      minute: m.minute as number,
      league: m.league,
      leagueLogo: m.leagueLogo || '',
      homeLogo: m.homeLogo || '',
      awayLogo: m.awayLogo || '',
      stadium: m.stadium || '',
      kickoff: m.kickoff || '',
      isHot: Boolean(m.isHot),
      events,
      homeForm,
      awayForm,
    }
  })
}

// --- Simulate live match progression (MOCK mode) ---
const GOAL_PLAYERS: Record<string, string[]> = {
  'Real Madrid': ['Vinícius Jr.', 'Mbappé', 'Bellingham', 'Rodrygo', 'Valverde', 'Modrić'],
  'Barcelona': ['Lewandowski', 'Yamal', 'Raphinha', 'Pedri', 'Gavi', 'de Jong'],
  'Manchester City': ['Haaland', 'Foden', 'De Bruyne', 'B. Silva', 'Álvarez', 'Rodri'],
  'Napoli': ['Kvaratskhelia', 'Osimhen', 'Politano', 'Zielinski'],
  'Bayern Munich': ['Kane', 'Musiala', 'Sané', 'Müller', 'Gnabry'],
  'Dortmund': ['Brandt', 'Adeyemi', 'Mukoko', 'Füllkrug'],
  'PSG': ['Dembélé', 'Kolo Muani', 'Asensio', 'Barcola'],
  'Marseille': ['Aubameyang', 'Rabiot'],
  'Celtic': ['Kyogo', "O'Riley", 'Hatate'],
  'Rangers': ['Dessers', 'Roofe', 'Sakala'],
  'Feyenoord': ['Giménez', 'Stengs', 'Timber'],
  'AZ Alkmaar': ['Pavlidis', 'de Wit'],
  'Lyon': ['Lacazette', 'Cherki', 'Caqueret'],
  'Monaco': ['Embolo', 'Ben Yedder', 'Golovin'],
}

async function simulateMatchUpdates(): Promise<GoalEvent[]> {
  const matches = await fetchMatchesFromDB()
  const goals: GoalEvent[] = []

  for (const match of matches) {
    if (match.status !== 'LIVE') continue

    let newMinute = match.minute + 1
    let newStatus = match.status
    let newHomeScore = match.homeScore
    let newAwayScore = match.awayScore
    let newIsHot = match.isHot

    if (newMinute > 90) { newMinute = 90; newStatus = 'FT' }
    if (newMinute === 46 && newStatus === 'LIVE') { newStatus = 'HT' }

    const homeGoalChance = Math.random() < 0.03
    const awayGoalChance = Math.random() < 0.03

    let eventsArr: any[] = []
    try { eventsArr = JSON.parse(match.events as string) } catch { eventsArr = [] }

    if (homeGoalChance && newMinute <= 90) {
      newHomeScore += 1
      const players = GOAL_PLAYERS[match.homeTeam] || ['Unknown']
      const scorer = players[Math.floor(Math.random() * players.length)]
      eventsArr.push({ type: 'goal', team: 'home', player: scorer, minute: newMinute })
      goals.push({
        fixtureId: match.id, homeTeam: match.homeTeam, awayTeam: match.awayTeam,
        score: `${newHomeScore}-${newAwayScore}`, minute: newMinute, status: newStatus,
        scoringTeam: 'home', playerName: scorer, homeScore: newHomeScore, awayScore: newAwayScore,
      })
    }

    if (awayGoalChance && newMinute <= 90) {
      newAwayScore += 1
      const players = GOAL_PLAYERS[match.awayTeam] || ['Unknown']
      const scorer = players[Math.floor(Math.random() * players.length)]
      eventsArr.push({ type: 'goal', team: 'away', player: scorer, minute: newMinute })
      goals.push({
        fixtureId: match.id, homeTeam: match.homeTeam, awayTeam: match.awayTeam,
        score: `${newHomeScore}-${newAwayScore}`, minute: newMinute, status: newStatus,
        scoringTeam: 'away', playerName: scorer, homeScore: newHomeScore, awayScore: newAwayScore,
      })
    }

    if (Math.random() < 0.02 && newMinute <= 90) {
      const isHome = Math.random() < 0.5
      const team = isHome ? 'home' : 'away'
      const teamName = isHome ? match.homeTeam : match.awayTeam
      const players = GOAL_PLAYERS[teamName] || ['Unknown']
      const player = players[Math.floor(Math.random() * players.length)]
      eventsArr.push({ type: 'yellow', team, player, minute: newMinute })
    }

    await db.match.update({
      where: { id: match.id },
      data: {
        homeScore: newHomeScore,
        awayScore: newAwayScore,
        minute: newMinute,
        status: newStatus,
        events: JSON.stringify(eventsArr),
        isHot: newIsHot,
      },
    })
  }
  return goals
}

// --- Real data sync from Football API ---
async function syncRealData(): Promise<GoalEvent[]> {
  const goals: GoalEvent[] = []

  try {
    const nextApiUrl = process.env.NEXT_API_URL || 'http://localhost:3000'
    const response = await fetch(`${nextApiUrl}/api/football`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncMode: 'live' }),
    })

    if (!response.ok) {
      console.error('Real data sync failed:', response.status)
      return goals
    }
  } catch (error) {
    console.error('Error syncing real data:', error)
  }

  return goals
}

// --- Check for changes and emit updates ---
async function checkAndEmitUpdates() {
  const rawMatches = await fetchMatchesFromDB()
  const formattedMatches = formatMatchData(rawMatches)
  const goals: GoalEvent[] = []

  for (const match of formattedMatches) {
    const prev = prevMatchesMap.get(match.id)
    if (!prev) continue

    if (match.status === 'LIVE' || match.status === 'HT') {
      if (match.homeScore > prev.homeScore) {
        const goalEvent = [...match.events].reverse().find(
          (e: any) => e.type === 'goal' && e.team === 'home' && e.minute === match.minute
        )
        goals.push({
          fixtureId: match.id, homeTeam: match.homeTeam, awayTeam: match.awayTeam,
          score: `${match.homeScore}-${match.awayScore}`, minute: match.minute, status: match.status,
          scoringTeam: 'home', playerName: goalEvent?.player || 'Unknown', homeScore: match.homeScore, awayScore: match.awayScore,
        })
      }
      if (match.awayScore > prev.awayScore) {
        const goalEvent = [...match.events].reverse().find(
          (e: any) => e.type === 'goal' && e.team === 'away' && e.minute === match.minute
        )
        goals.push({
          fixtureId: match.id, homeTeam: match.homeTeam, awayTeam: match.awayTeam,
          score: `${match.homeScore}-${match.awayScore}`, minute: match.minute, status: match.status,
          scoringTeam: 'away', playerName: goalEvent?.player || 'Unknown', homeScore: match.homeScore, awayScore: match.awayScore,
        })
      }
    }
  }

  const newMap = new Map<string, { homeScore: number; awayScore: number; status: string; minute: number }>()
  for (const match of formattedMatches) {
    newMap.set(match.id, { homeScore: match.homeScore, awayScore: match.awayScore, status: match.status, minute: match.minute })
  }

  let hasChanges = prevMatchesMap.size !== newMap.size
  if (!hasChanges) {
    for (const [id, data] of newMap) {
      const prev = prevMatchesMap.get(id)
      if (!prev || prev.homeScore !== data.homeScore || prev.awayScore !== data.awayScore || prev.status !== data.status || prev.minute !== data.minute) {
        hasChanges = true
        break
      }
    }
  }

  prevMatchesMap = newMap

  if (hasChanges || goals.length > 0) {
    for (const goal of goals) {
      console.log(`⚽ GOAL! ${goal.homeTeam} ${goal.homeScore} - ${goal.awayScore} ${goal.awayTeam} (${goal.playerName} ${goal.minute}')`)
      io.emit('goalScored', goal)
    }
    io.emit('liveMatchesUpdate', { matches: formattedMatches, timestamp: new Date().toISOString() })
    if (hasChanges && goals.length === 0) console.log('📡 Match data updated (no goals)')
  }
}

// --- Client Count Tracking ---
let connectedClientCount = 0
function broadcastClientCount() { io.emit('clientCount', connectedClientCount) }

// --- Socket.IO Connection Handler ---
io.on('connection', (socket) => {
  connectedClientCount++
  console.log(`🔌 Client connected: ${socket.id} (${connectedClientCount} total)`)
  broadcastClientCount()

    // Send initial data asynchronously (non-blocking)
    ; (async () => {
      try {
        const rawMatches = await fetchMatchesFromDB()
        const formattedMatches = formatMatchData(rawMatches)
        const scorers = await fetchScorersFromDB()
        const standings = await fetchStandingsFromDB()
        socket.emit('initialData', { matches: formattedMatches, scorers, standings, timestamp: new Date().toISOString() })
      } catch (err) {
        console.error('Error sending initial data:', err)
      }
    })()

  socket.on('requestUpdate', async () => {
    try {
      const rawMatches = await fetchMatchesFromDB()
      const formattedMatches = formatMatchData(rawMatches)
      socket.emit('liveMatchesUpdate', { matches: formattedMatches, timestamp: new Date().toISOString() })
    } catch (err) {
      console.error('Error on requestUpdate:', err)
    }
  })

  socket.on('disconnect', (reason) => {
    connectedClientCount--
    console.log(`🔌 Client disconnected: ${socket.id} (${connectedClientCount} remaining) (${reason})`)
    broadcastClientCount()
  })

  socket.on('error', (error) => { console.error(`Socket error (${socket.id}):`, error) })
})

// =============================================
// START SERVER FIRST (so health check passes)
// THEN initialize database connection
// =============================================
const PORT = parseInt(process.env.PORT || '3003', 10)

httpServer.listen(PORT, () => {
  console.log(`⚽ GOALZONE WebSocket Server running on port ${PORT}`)
  console.log(`📡 Data mode: ${process.env.DATA_MODE || 'mock'}`)
  console.log(`💾 Database URL: ${process.env.DATABASE_URL ? 'set ✅' : 'NOT SET ❌'}`)
})

  // --- Initialize database + start update loop (non-blocking) ---
  ; (async () => {
    // Test database connection
    try {
      await db.$connect()
      dbConnected = true
      console.log('✅ Database connected!')

      // Load initial match data
      const initialMatches = await fetchMatchesFromDB()
      const initialFormatted = formatMatchData(initialMatches)
      for (const match of initialFormatted) {
        prevMatchesMap.set(match.id, { homeScore: match.homeScore, awayScore: match.awayScore, status: match.status, minute: match.minute })
      }
      console.log(`📊 Loaded ${initialFormatted.length} matches from database`)

      // Determine data mode
      const DATA_MODE = process.env.DATA_MODE || 'mock'
      const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY || ''
      const useRealData = DATA_MODE === 'real' && FOOTBALL_API_KEY.length > 0

      const SIMULATION_INTERVAL = 10000
      const REAL_SYNC_INTERVAL = 30000

      setInterval(async () => {
        try {
          if (useRealData) {
            await syncRealData()
          } else {
            await simulateMatchUpdates()
          }
          await checkAndEmitUpdates()
        } catch (err) {
          console.error('Error in update cycle:', err)
        }
      }, useRealData ? REAL_SYNC_INTERVAL : SIMULATION_INTERVAL)

      console.log(`⏱️  Update interval: ${useRealData ? REAL_SYNC_INTERVAL / 1000 : SIMULATION_INTERVAL / 1000}s`)
    } catch (err) {
      console.error('❌ Database connection failed:', err)
      console.error('⚠️  Server is running but without database. Health check will still pass.')
      console.error('⚠️  Check your DATABASE_URL environment variable.')

      // Retry database connection every 10 seconds
      const retryInterval = setInterval(async () => {
        try {
          await db.$connect()
          dbConnected = true
          console.log('✅ Database connected on retry!')
          clearInterval(retryInterval)
        } catch {
          console.error('❌ Database retry failed...')
        }
      }, 10000)
    }
  })()

// --- Graceful Shutdown ---
process.on('SIGTERM', () => {
  httpServer.close(async () => {
    await db.$disconnect()
    process.exit(0)
  })
})
process.on('SIGINT', () => {
  httpServer.close(async () => {
    await db.$disconnect()
    process.exit(0)
  })
})
