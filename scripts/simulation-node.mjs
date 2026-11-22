/** 单节点执行模板：stdin JSON 输入，stdout JSON Lines 进度/结果，stderr 诊断。 */
import { calculate, TASKS } from '../simulation/kernels.mjs'
import { setTimeout as delay } from 'node:timers/promises'
// 子进程由调度器使用参数数组启动，任务名来自受校验的模板白名单。
const task = process.argv[2]
const write = value => process.stdout.write(JSON.stringify(value) + '\n')
try {
  if (!TASKS.has(task)) throw new Error('未注册的仿真内核。')
  let input = ''
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 1_000_000) throw new Error('节点输入过大。') }
  const payload = JSON.parse(input)
  const started = Date.now()
  // demoPacingMs 是明确的展示节奏，不把等待时间当作实际计算耗时。
  const pacingMs = payload.demoPacingMs
  write({ type: 'progress', progress: 0, message: '读取父节点结果，开始计算' })
  let batches = 0
  const result = await calculate(task, payload, async (fraction, message) => {
    batches++
    write({ type: 'progress', progress: Math.round(fraction * 90), message })
    if (pacingMs) await delay(pacingMs / 8)
  })
  if (!batches && pacingMs) { write({ type: 'progress', progress: 70, message: '数值计算完成，等待演示展示节奏' }); await delay(pacingMs) }
  write({ type: 'result', result, elapsedMs: Date.now() - started })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
