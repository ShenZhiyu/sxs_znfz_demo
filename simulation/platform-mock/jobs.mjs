import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { lookup } from './environment.mjs'
import { MockError } from './http.mjs'

const records = new Map([['demo-record', { recordId: 'demo-record', title: '合成链路回放记录' }]])
const evalFixtures = new Map([
  ['demo-eval', { verdict: 'pass', summary: '合成验证用例通过。', nodeStatus: 'online' }],
  ['demo-eval-fail', { verdict: 'fail', summary: '合成验证用例未通过。', nodeStatus: 'busy' }],
  ['demo-eval-insufficient', { verdict: 'insufficient_evidence', summary: '预置证据不足。', nodeStatus: 'busy' }],
  ['demo-eval-failed', { failureCode: 'MOCK_EVAL_FAILED', nodeStatus: 'offline' }],
])

function registerJobs(add, path, schema, prepare) {
  const jobs = new Map()
  const results = new Map()
  add('POST', `/${path}/jobs`, schema, input => {
    const outcome = prepare(input)
    const jobId = randomUUID()
    jobs.set(jobId, { jobId, status: 'queued', outcome })
    return { jobId, status: 'queued' }
  }, { write: true, status: 202 })

  add('GET', `/${path}/jobs/:jobId`, z.strictObject({}), (_, { jobId }) => {
    const job = lookup(jobs, jobId, 'jobId')
    if (job.status === 'queued') {
      job.status = 'running'
    } else if (job.status === 'running') {
      const { result, failureCode } = job.outcome
      if (failureCode) {
        job.status = 'failed'
        job.failureCode = failureCode
      } else {
        job.status = 'succeeded'
        job.resultId = randomUUID()
        results.set(job.resultId, result)
      }
    }
    const { status, resultId, failureCode } = job
    return { jobId, status, resultId, failureCode }
  })
  add('GET', `/${path}/results/:resultId`, z.strictObject({}),
    (_, { resultId }) => lookup(results, resultId, 'resultId'))
  return results
}

export function registerReplayAndEval(add) {
  const fixtureId = z.string()
  add('GET', '/replay/records', z.strictObject({}), () => ({ items: [...records.values()] }))
  const replayResults = registerJobs(add, 'replay', z.strictObject({ fixtureId, recordId: z.string() }), input => {
    if (input.fixtureId !== 'demo-replay') throw new MockError(404, '找不到指定 fixture', 'fixtureId')
    const { recordId } = lookup(records, input.recordId, 'recordId')
    return { result: { recordId, events: [
      { offsetMs: 0, label: '开始回放' },
      { offsetMs: 100, label: '读取合成帧' },
      { offsetMs: 200, label: '回放结束' },
    ] } }
  })

  registerJobs(add, 'eval', z.strictObject({ fixtureId, inputRefs: z.array(z.string()).optional() }), input => {
    const fixture = lookup(evalFixtures, input.fixtureId, 'fixtureId')
    const evidenceRefs = input.inputRefs ?? []
    for (const ref of evidenceRefs) {
      if (ref.startsWith('replay:')) lookup(replayResults, ref.slice('replay:'.length), 'inputRefs')
    }
    if (fixture.failureCode) return { failureCode: fixture.failureCode }
    return { result: { verdict: fixture.verdict, summary: fixture.summary, evidenceRefs } }
  })
  add('GET', '/eval/status-fixtures/:fixtureId', z.strictObject({}), (_, params) => ({
    items: [{ nodeId: 'demo-eval-node', status: lookup(evalFixtures, params.fixtureId, 'fixtureId').nodeStatus }],
  }))
}
