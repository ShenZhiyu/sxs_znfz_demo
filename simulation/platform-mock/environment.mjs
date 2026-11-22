import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { MockError } from './http.mjs'

const longitude = z.number().min(-180).max(180)
const latitude = z.number().min(-90).max(90)
const bounds = z.strictObject({ west: longitude, east: longitude, south: latitude, north: latitude })
  .refine(value => value.west <= value.east, { path: ['east'] })
  .refine(value => value.south <= value.north, { path: ['north'] })
const metadata = z.strictObject({
  category: z.string(), element: z.string(), name: z.string(), format: z.string(),
  generatedDate: z.iso.date(),
  producer: z.string().optional(), instrument: z.string().optional(), operator: z.string().optional(),
  surveyTopic: z.string().optional(), bounds: bounds.optional(),
})
const numberParam = schema => z.string().regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i)
  .transform(Number).pipe(schema)
const coordinates = {
  longitude: numberParam(longitude),
  latitude: numberParam(latitude),
}
const layer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwaNgAAAJ0AXEtToDwAAAAAElFTkSuQmCC', 'base64')
const noiseRecord = { samples: [0, 0.125, -0.125, 0.25], durationS: 0.004, levelDb: 42 }
const channelRecord = { response: [1, 0.2, -0.05], delaysS: [0, 0.001, 0.003], durationS: 0.004, dopplerHz: 0 }
const modes = ['point_to_point', 'single_point_single_bearing', 'single_point_multi_bearing', 'multi_point_multi_bearing']

export function lookup(entries, id, field) {
  if (!entries.has(id)) throw new MockError(404, '找不到指定资源', field)
  return entries.get(id)
}

function environment(longitude, latitude) {
  return {
    longitude, latitude,
    waterColumn: [
      { depthM: 0, temperatureC: 18, salinityPsu: 34, soundSpeedMps: 1515 },
      { depthM: 50, temperatureC: 10, salinityPsu: 35, soundSpeedMps: 1492 },
    ],
    seabed: { kind: 'sand', soundSpeedMps: 1650, densityGcm3: 1.8, attenuationDbPerWavelength: 0.7 },
    bathymetry: [{ distanceKm: 0, waterDepthM: 120 }, { distanceKm: 2, waterDepthM: 130 }],
  }
}

function fieldResult(mode) {
  const axes = {
    sourceIds: mode === modes[3] ? ['source-1', 'source-2'] : ['source-1'],
    sourceDepthsM: [20], frequenciesHz: [1000],
    bearingsDeg: modes.indexOf(mode) >= 2 ? [0, 90] : [0],
    receiverDepthsM: mode === modes[0] ? [30] : [30, 60],
    receiverRangesKm: mode === modes[0] ? [1] : [1, 2, 3],
  }
  const slices = axes.sourceIds.flatMap((_, sourceIndex) => axes.bearingsDeg.map((_, bearingIndex) => ({
    sourceIndex, sourceDepthIndex: 0, frequencyIndex: 0, bearingIndex,
    transmissionLossDb: axes.receiverDepthsM.map((_, row) =>
      axes.receiverRangesKm.map((_, column) => 50 + row + column * 3 + sourceIndex + bearingIndex)),
    pressure: axes.receiverDepthsM.map((_, row) =>
      axes.receiverRangesKm.map((_, column) => ({ real: 1 / (1 + row + column), imag: 0 }))),
  })))
  return { axes, slices }
}

export function registerEnvironment(add) {
  const seedMetadata = {
    category: 'ocean', element: 'water-column', name: '合成环境', format: 'json', generatedDate: '2026-01-01',
  }
  const seedContent = { environment: environment(120, 30) }
  const datasets = new Map([['demo-environment', {
    metadata: seedMetadata, published: true, content: seedContent,
  }]])

  add('POST', '/env/datasets', z.strictObject({
    metadata, content: z.record(z.string(), z.json()),
  }), (input) => {
    const datasetId = randomUUID()
    datasets.set(datasetId, { ...input, published: false })
    return { datasetId, metadata: input.metadata }
  }, { write: true, status: 201, file: metadata })

  add('GET', '/env/datasets', z.strictObject({
    category: z.string().optional(), element: z.string().optional(),
    published: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  }), filters => ({
    items: [...datasets].flatMap(([datasetId, dataset]) => {
      const { metadata, published } = dataset
      if (filters.category !== undefined && filters.category !== metadata.category) return []
      if (filters.element !== undefined && filters.element !== metadata.element) return []
      if (filters.published !== undefined && filters.published !== published) return []
      return [{ datasetId, metadata, published }]
    }),
  }))

  add('GET', '/env/datasets/:datasetId/content', z.strictObject({
    view: z.enum(['json', 'file', 'layer']).default('json'),
  }), ({ view }, { datasetId }) => {
    const dataset = lookup(datasets, datasetId, 'datasetId')
    if (view === 'layer') return { bytes: layer, type: 'image/png' }
    if (view === 'file') {
      const file = dataset.file ?? { bytes: Buffer.from(JSON.stringify(dataset.content)), type: 'application/json' }
      return { bytes: file.bytes, type: file.type || 'application/octet-stream', download: true }
    }
    if (dataset.content) return { content: dataset.content }
    // A file import can have a JSON view when its bytes represent a JSON object.
    let content
    try { content = JSON.parse(dataset.file.bytes.toString('utf8')) } catch {}
    if (content === null || typeof content !== 'object' || Array.isArray(content) ||
        !z.json().safeParse(content).success) {
      throw new MockError(422, '文件内容无法作为 JSON 对象读取', 'view')
    }
    return { content }
  }, { binary: true })

  add('GET', '/env/config', z.strictObject({}), () => ({
    categories: ['ocean', 'seabed', 'ambient'],
    elements: ['water-column', 'bathymetry', 'noise', 'channel'],
    analysisDefaults: { month: 1 },
  }))

  add('GET', '/env/history', z.strictObject({
    ...coordinates, month: numberParam(z.int().min(1).max(12)),
  }), input => ({ environment: environment(input.longitude, input.latitude) }))
  add('GET', '/env/observations', z.strictObject(coordinates),
    input => ({ environment: environment(input.longitude, input.latitude) }))

  const noiseRecords = new Map([['demo-noise', noiseRecord]])
  const channelRecords = new Map([['demo-channel', channelRecord]])
  add('GET', '/env/noise-records/:recordId', z.strictObject({}),
    (_, { recordId }) => lookup(noiseRecords, recordId, 'recordId'))
  add('GET', '/env/channel-records/:recordId', z.strictObject({}),
    (_, { recordId }) => lookup(channelRecords, recordId, 'recordId'))
  add('PATCH', '/env/datasets/:datasetId', z.strictObject({ published: z.boolean() }),
    ({ published }, { datasetId }) => {
      lookup(datasets, datasetId, 'datasetId').published = published
      return { datasetId, published }
    }, { write: true })

  add('POST', '/field/simulations', z.strictObject({
    fixtureId: z.string(), mode: z.enum(modes), environmentRef: z.string().optional(),
  }), ({ fixtureId, mode, environmentRef }) => {
    if (fixtureId !== 'demo-field') throw new MockError(404, '找不到指定 fixture', 'fixtureId')
    if (environmentRef !== undefined) lookup(datasets, environmentRef, 'environmentRef')
    return fieldResult(mode)
  })
}
