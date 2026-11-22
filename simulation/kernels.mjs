/** 简化数值内核：Thorp 损失、几何三径、AWGN 比特检测和独立误码分组演示。 */
// 同一参数和种子可重复得到相同结果；不同模块使用不同的确定性种子流。
function generator(seed, tag) {
  let state = (seed + [...tag].reduce((sum, ch) => sum + ch.charCodeAt(0), 0)) >>> 0 || 1
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return ((state >>> 0) + 0.5) / 4294967296 }
}
// Box–Muller 生成单位高斯样本；它用于真实的加噪和阈值检测，而不是直接填写 BER。
function gaussian(random) { return Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random()) }
// 高频支采用常见 Thorp dB/km 近似；低频支与 ns-3 UAN 的分段形式一致。
export function absorptionDbKm(frequencyKhz) {
  const f2 = frequencyKhz ** 2
  return frequencyKhz >= 0.4 ? 0.11 * f2 / (1 + f2) + 44 * f2 / (4100 + f2) + 2.75e-4 * f2 + 0.003 : 0.002 + 0.11 * f2 / (1 + f2) + 0.011 * f2
}
// 已核对的任务白名单；模板不能让模型指定任意本机命令。
export const TASKS = new Set(['scenario', 'propagation', 'multipath', 'noise', 'channel-summary', 'comm-qpsk', 'comm-bpsk', 'link-budget', 'link-monte-carlo', 'report'])

// 长计算按批次让出进度；所有依赖输入都来自同一任务里已成功的父节点。
export async function calculate(task, { parameters: p, inputs, policy }, progress) {
  const random = generator(p.seed, task)
  if (task === 'scenario') return { parameters: p, sampleBits: policy.sampleBits, packetTrials: policy.packetTrials, fidelity: 'demo-simplified', units: 'm, kHz, Hz, dB' }
  if (task === 'propagation') {
    const alpha = absorptionDbKm(p.carrierKhz)
    return { absorptionDbKm: alpha, spreadingCoefficient: 1.5, lossDb: 15 * Math.log10(p.distanceM) + alpha * p.distanceM / 1000, delaySeconds: p.distanceM / p.soundSpeedMps }
  }
  if (task === 'multipath') {
    const lengths = [p.distanceM, Math.hypot(p.distanceM, 2 * p.depthM), Math.hypot(p.distanceM, 4 * p.depthM)]
    const weights = [1, 0.35, 0.12], weightSum = weights.reduce((a, b) => a + b)
    const paths = lengths.map((length, i) => ({ relativeDelaySeconds: (length - p.distanceM) / p.soundSpeedMps, power: weights[i] / weightSum }))
    const mean = paths.reduce((sum, path) => sum + path.relativeDelaySeconds * path.power, 0)
    return { paths, rmsDelaySpreadSeconds: Math.sqrt(paths.reduce((sum, path) => sum + (path.relativeDelaySeconds - mean) ** 2 * path.power, 0)), dopplerHz: p.relativeSpeedMps / p.soundSpeedMps * p.carrierKhz * 1000, model: 'illustrative-three-ray-geometry' }
  }
  if (task === 'noise') return { noisePsdDb: p.noisePsdDb, bandwidthHz: p.bandwidthHz, integratedNoiseDb: p.noisePsdDb + 10 * Math.log10(p.bandwidthHz), model: 'flat-noise-density' }
  if (task === 'channel-summary') {
    const propagation = inputs.propagation, multipath = inputs.multipath, noise = inputs.noise
    return { ...propagation, ...multipath, ...noise, receivedLevelDb: p.sourceLevelDb - propagation.lossDb, snrDb: p.sourceLevelDb - propagation.lossDb - noise.integratedNoiseDb, isiPenaltyDb: Math.min(4, 10 * Math.log10(1 + multipath.rmsDelaySpreadSeconds * p.bandwidthHz * 0.05)), fidelity: 'scalar-effective-channel; not a waveform multipath solver' }
  }
  if (task === 'comm-qpsk' || task === 'comm-bpsk') {
    const channel = inputs['channel-summary'], bitsPerSymbol = task === 'comm-qpsk' ? 2 : 1
    const bitRateBps = p.bandwidthHz * bitsPerSymbol
    const ebN0Db = channel.snrDb + 10 * Math.log10(p.bandwidthHz / bitRateBps) - channel.isiPenaltyDb
    const sigma = Math.sqrt(1 / (2 * 10 ** (ebN0Db / 10)))
    let bitErrors = 0, processed = 0
    // QPSK 的 Gray I/Q 两支分别做二进制阈值检测；这里只保留等效基带比特统计。
    for (let batch = 0; batch < 8; batch++) {
      const end = Math.floor(policy.sampleBits * (batch + 1) / 8)
      for (; processed < end; processed++) {
        const bit = random() > 0.5, received = (bit ? 1 : -1) + sigma * gaussian(random)
        if ((received >= 0) !== bit) bitErrors++
      }
      await progress((batch + 1) / 8, `已检测 ${processed} 个比特`)
    }
    return { modulation: bitsPerSymbol === 2 ? 'QPSK' : 'BPSK', bitRateBps, ebN0Db, bits: processed, bitErrors, ber: bitErrors / processed, model: 'uncoded Gray coherent AWGN bit detector with heuristic ISI penalty' }
  }
  if (task === 'link-budget') {
    const candidates = ['comm-qpsk', 'comm-bpsk'].map(id => {
      const comm = inputs[id], estimatedPdr = (1 - comm.ber) ** p.packetBits
      return { ...comm, estimatedPdr, estimatedGoodputBps: comm.bitRateBps * estimatedPdr }
    }).sort((a, b) => b.estimatedGoodputBps - a.estimatedGoodputBps)
    return { candidates, selected: candidates[0], propagationDelaySeconds: inputs['channel-summary'].delaySeconds, packetBits: p.packetBits, assumption: 'independent bit errors; no coding, MAC contention or retransmission' }
  }
  if (task === 'link-monte-carlo') {
    const budget = inputs['link-budget'], successProbability = budget.selected.estimatedPdr
    let delivered = 0, attempted = 0
    for (let batch = 0; batch < 8; batch++) {
      const end = Math.floor(policy.packetTrials * (batch + 1) / 8)
      for (; attempted < end; attempted++) if (random() < successProbability) delivered++
      await progress((batch + 1) / 8, `已统计 ${attempted} 个分组`)
    }
    return { packets: attempted, delivered, packetDeliveryRatio: delivered / attempted, goodputBps: budget.selected.bitRateBps * delivered / attempted, oneWayLatencySeconds: p.packetBits / budget.selected.bitRateBps + budget.propagationDelaySeconds, seed: p.seed }
  }
  if (task === 'report') return { fidelity: 'demo-simplified', parameters: p, channel: inputs['channel-summary'], comparison: inputs['link-budget'].candidates, selectedModulation: inputs['link-budget'].selected.modulation, link: inputs['link-monte-carlo'], caveats: ['本机演示配额，不是真实集群隔离', '三径与 ISI 为示意模型，不是海洋声场求解器', '分组独立误码假设；有限样本零误码不代表真实 BER 为零'] }
  throw new Error(`模板引用了未知计算任务：${task}`)
}
