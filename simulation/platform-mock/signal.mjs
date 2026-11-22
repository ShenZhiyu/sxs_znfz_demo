import { z } from 'zod'
import { fingerprint, MockError } from './http.mjs'

const fixtureId = z.string()
const bitArray = z.array(z.union([z.literal(0), z.literal(1)]))
const noise = [0, 0.125, -0.125, 0.25]
const signalSamples = [0, 1, 0, -1, 0, 1, 0, -1]
const decodedBits = [0, 1, 0, 0]

function requireFixture(id) {
  if (id !== 'demo-signal') throw new MockError(404, '找不到指定 fixture', 'fixtureId')
}

function requireRef(ref, kind, known) {
  const field = kind + 'Ref'
  if (!new RegExp('^' + kind + ':[a-f0-9]{64}$').test(ref)) {
    throw new MockError(422, '依赖引用类型不匹配', field)
  }
  if (!known.has(ref)) throw new MockError(404, '找不到指定引用', field)
}

export function registerSignal(add) {
  const encodings = new Set()
  const signals = new Set()
  add('POST', '/signals/channel', z.strictObject({ fixtureId }), input => {
    requireFixture(input.fixtureId)
    return { response: [1, 0.2, -0.05], delaySampleRateHz: 1000, dopplerHz: 0 }
  })
  add('POST', '/signals/noise', z.strictObject({ fixtureId, sampleCount: z.int().positive().max(100_000) }),
    ({ fixtureId, sampleCount }) => {
      requireFixture(fixtureId)
      return { samples: Array.from({ length: sampleCount }, (_, index) => noise[index % noise.length]), sampleCount, levelDb: 42 }
    })
  add('POST', '/signals/encode', z.strictObject({ fixtureId, bits: bitArray }), input => {
    requireFixture(input.fixtureId)
    const encodedRef = 'encoded:' + fingerprint(input)
    encodings.add(encodedRef)
    return { encodedRef, bitCount: input.bits.length }
  })
  add('POST', '/signals/synthesize', z.strictObject({ fixtureId, encodedRef: z.string().optional() }), input => {
    requireFixture(input.fixtureId)
    if (input.encodedRef !== undefined) requireRef(input.encodedRef, 'encoded', encodings)
    const signalRef = 'signal:' + fingerprint(input)
    signals.add(signalRef)
    return { signalRef, samples: signalSamples, sampleRateHz: 8000 }
  })
  add('POST', '/signals/decode', z.strictObject({ fixtureId, signalRef: z.string() }), input => {
    requireFixture(input.fixtureId)
    requireRef(input.signalRef, 'signal', signals)
    return { bits: decodedBits, bitCount: decodedBits.length }
  })
  add('POST', '/signals/statistics', z.strictObject({ expectedBits: bitArray.min(1), actualBits: bitArray.min(1) }),
    ({ expectedBits, actualBits }) => {
      const comparedBits = expectedBits.length
      if (actualBits.length !== comparedBits) throw new MockError(422, '比特数组长度不一致', 'actualBits')
      const bitErrors = expectedBits.reduce((count, bit, index) => count + Number(bit !== actualBits[index]), 0)
      return { comparedBits, bitErrors, bitErrorRate: bitErrors / comparedBits }
    })
}
